import mongoose from "mongoose";
import razorpay from "../config/razorpay.js";
import Donation from "../models/donation.model.js";
import Payment from "../models/payment.model.js";
import { capturePaymentService } from "./payment.service.js";

// Checks pending online donations against Razorpay and settles the clear
// cases. Every other case is left untouched and reported:
//
//   captured, full amount, not refunded -> success, through
//       capturePaymentService (it re-fetches the payment live, checks the
//       order, credits totals once, then runs DCC + receipt + WhatsApp)
//   every attempt failed                -> failed, nothing sent
//   anything else                       -> no change, needs a human
//
// Receipts and notifications only ever go out from capturePaymentService
// after a live "captured" confirmation, never from this file.

export const OUTCOMES = {
  SUCCESS: "success",
  FAILED: "failed",
  NO_ATTEMPT: "no_payment_attempted",
  AUTHORIZED: "authorized_not_captured",
  REVIEW: "needs_manual_review",
  ERROR: "could_not_verify",
  ALREADY_FAILED: "already_failed",
};

// Donations younger than this may still be mid-checkout.
const DEFAULT_MIN_AGE_MINUTES = 30;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
// Checking runs a few donations in parallel; applying runs one at a time,
// so receipts, DCC syncs and totals are written strictly in sequence.
const CHECK_CONCURRENCY = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const describeError = (error) =>
  error?.error?.description || error?.message || String(error);

const isNotFound = (error) => {
  const statusCode = error?.statusCode || error?.status;
  return (
    (statusCode === 400 || statusCode === 404) &&
    (error?.error?.code === "BAD_REQUEST_ERROR" ||
      describeError(error).toLowerCase().includes("does not exist"))
  );
};

// Retries rate limits and network errors; a genuine "does not exist" is
// returned as null so callers can tell it apart from a failure to check.
const callRazorpay = async (fn, attempt = 1) => {
  try {
    return await fn();
  } catch (error) {
    if (isNotFound(error)) return null;
    if (attempt < 4) {
      await sleep(500 * 2 ** (attempt - 1));
      return callRazorpay(fn, attempt + 1);
    }
    throw error;
  }
};

// Every payment attempt Razorpay has for this donation: orders we have on
// record plus any order created with the donation id as its receipt (an
// order id we stored can be overwritten when the donor retries checkout).
const collectAttempts = async (donation) => {
  const donationId = donation._id.toString();
  const paymentDocs = await Payment.find({ donation: donation._id })
    .select("gatewayOrderId status")
    .lean();

  const orderIds = new Set(
    paymentDocs.map((doc) => doc.gatewayOrderId).filter(Boolean),
  );

  const orders = await callRazorpay(() =>
    razorpay.orders.all({ receipt: donationId, count: 100 }),
  );
  for (const order of orders?.items ?? []) {
    orderIds.add(order.id);
  }

  const attempts = new Map();
  for (const orderId of orderIds) {
    const result = await callRazorpay(() => razorpay.orders.fetchPayments(orderId));
    for (const payment of result?.items ?? []) {
      attempts.set(payment.id, payment);
    }
  }

  if (donation.gatewayPaymentId?.startsWith("pay_")) {
    const payment = await callRazorpay(() =>
      razorpay.payments.fetch(donation.gatewayPaymentId),
    );
    if (payment) attempts.set(payment.id, payment);
  }

  return { attempts: [...attempts.values()], orderIds: [...orderIds] };
};

const summarizeAttempts = (attempts) =>
  attempts.map((p) => ({
    id: p.id,
    orderId: p.order_id,
    status: p.status,
    amount: p.amount / 100,
    refunded: (p.amount_refunded || 0) / 100,
  }));

export const decideOutcome = (donation, attempts) => {
  if (attempts.length === 0) {
    return { outcome: OUTCOMES.NO_ATTEMPT, reason: "Donor never attempted payment" };
  }

  const expectedPaise = Math.round(Number(donation.amount) * 100);
  const captured = attempts.filter((p) => p.status === "captured");
  const clean = captured.filter(
    (p) => !p.amount_refunded && p.currency === "INR" && p.amount === expectedPaise,
  );

  if (clean.length === 1) {
    return { outcome: OUTCOMES.SUCCESS, payment: clean[0], reason: `Captured ${clean[0].id}` };
  }
  if (clean.length > 1) {
    return {
      outcome: OUTCOMES.REVIEW,
      reason: `${clean.length} captured payments for one donation (${clean.map((p) => p.id).join(", ")}): possible double payment`,
    };
  }
  if (captured.length > 0) {
    const p = captured[0];
    return {
      outcome: OUTCOMES.REVIEW,
      reason: p.amount_refunded
        ? `Captured ${p.id} but ₹${p.amount_refunded / 100} refunded`
        : `Captured ${p.id} for ₹${p.amount / 100} ${p.currency}, donation is ₹${donation.amount}`,
    };
  }

  if (attempts.some((p) => p.status === "authorized")) {
    return {
      outcome: OUTCOMES.AUTHORIZED,
      reason: "Authorized but not captured yet; Razorpay captures or auto-refunds it",
    };
  }
  if (attempts.some((p) => p.status === "refunded")) {
    return { outcome: OUTCOMES.REVIEW, reason: "Payment was refunded" };
  }
  if (attempts.every((p) => p.status === "failed")) {
    return { outcome: OUTCOMES.FAILED, reason: `All ${attempts.length} attempt(s) failed` };
  }

  return {
    outcome: OUTCOMES.REVIEW,
    reason: `Unexpected payment status: ${attempts.map((p) => p.status).join(", ")}`,
  };
};

// Points this donation's Payment record at the order the captured payment
// belongs to, so capturePaymentService can find it.
const ensurePaymentRecordFor = async (donation, payment) => {
  const existing = await Payment.findOne({ gatewayOrderId: payment.order_id });
  if (existing) {
    if (existing.donation?.toString() !== donation._id.toString()) {
      throw new Error(
        `Order ${payment.order_id} is linked to another donation (${existing.donation})`,
      );
    }
    return;
  }

  const reusable = await Payment.findOne({
    donation: donation._id,
    status: { $ne: "captured" },
  }).sort({ createdAt: -1 });

  if (reusable) {
    reusable.gatewayOrderId = payment.order_id;
    await reusable.save();
    return;
  }

  await Payment.create({
    donation: donation._id,
    gatewayOrderId: payment.order_id,
    amount: donation.amount,
    currency: payment.currency,
  });
};

const applyOutcome = async (donation, decision) => {
  if (decision.outcome === OUTCOMES.SUCCESS) {
    await ensurePaymentRecordFor(donation, decision.payment);
    const result = await capturePaymentService({
      gatewayOrderId: decision.payment.order_id,
      gatewayPaymentId: decision.payment.id,
      rawResponse: decision.payment,
      donationId: donation._id.toString(),
    });
    return result.message;
  }

  if (decision.outcome === OUTCOMES.FAILED) {
    // Only ever moves pending -> failed; a donation that became success in
    // the meantime (e.g. a late webhook) is left alone.
    const updated = await Donation.updateOne(
      { _id: donation._id, status: "pending" },
      { $set: { status: "failed" } },
    );
    if (updated.modifiedCount === 0) {
      return "Status changed meanwhile; left as is";
    }
    await Payment.updateMany(
      { donation: donation._id, status: { $ne: "captured" } },
      { $set: { status: "failed" } },
    );
    return "Marked failed (no receipt, no notification)";
  }

  return "No change";
};

const reconcileOne = async (donation, { apply }) => {
  const base = {
    donationId: donation._id.toString(),
    donorName: donation.donorName,
    donorPhone: donation.donorPhone,
    amount: donation.amount,
    createdAt: donation.createdAt,
  };

  let collected;
  try {
    collected = await collectAttempts(donation);
  } catch (error) {
    return { ...base, outcome: OUTCOMES.ERROR, reason: describeError(error), applied: false };
  }

  const decision = decideOutcome(donation, collected.attempts);
  const row = {
    ...base,
    outcome: decision.outcome,
    reason: decision.reason,
    paymentId: decision.payment?.id || null,
    orderIds: collected.orderIds,
    attempts: summarizeAttempts(collected.attempts),
    applied: false,
  };

  // A donation already marked failed is only ever moved to success, when
  // Razorpay shows it was paid after all; otherwise it is left as is.
  if (donation.status === "failed" && decision.outcome !== OUTCOMES.SUCCESS) {
    row.outcome = OUTCOMES.ALREADY_FAILED;
    return row;
  }

  if (!apply || ![OUTCOMES.SUCCESS, OUTCOMES.FAILED].includes(decision.outcome)) {
    return row;
  }

  try {
    row.result = await applyOutcome(donation, decision);
    row.applied = true;
  } catch (error) {
    row.outcome = OUTCOMES.ERROR;
    row.result = `Not applied: ${describeError(error)}`;
  }
  return row;
};

/**
 * @param {object} options
 * @param {boolean} [options.apply=false]  false = report only, change nothing
 * @param {string[]} [options.donationIds] check exactly these (still must be pending)
 * @param {Date|string} [options.before]   only donations created before this
 * @param {number} [options.limit=100]
 * @param {number} [options.minAgeMinutes=30]
 * @param {boolean} [options.includeFailed=false] also re-check failed
 *   donations, which can only be moved to success (paid after all)
 */
export const reconcilePendingDonations = async ({
  apply = false,
  donationIds,
  before,
  limit = DEFAULT_LIMIT,
  minAgeMinutes = DEFAULT_MIN_AGE_MINUTES,
  includeFailed = false,
} = {}) => {
  const statuses = includeFailed ? ["pending", "failed"] : ["pending"];
  const cutoff = new Date(Date.now() - Number(minAgeMinutes) * 60 * 1000);
  const createdBefore = before && new Date(before) < cutoff ? new Date(before) : cutoff;

  // Online donations only; offline ones are recorded as success directly.
  // (Older records may predate the paymentGateway field.)
  const filter = {
    status: { $in: statuses },
    paymentGateway: { $in: ["razorpay", null] },
    createdAt: { $lt: createdBefore },
  };

  if (Array.isArray(donationIds) && donationIds.length > 0) {
    const validIds = donationIds.filter((id) => mongoose.isValidObjectId(id));
    filter._id = { $in: validIds };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const donations = await Donation.find(filter)
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .select("donorName donorPhone amount status createdAt gatewayPaymentId")
    .lean();

  const concurrency = apply ? 1 : CHECK_CONCURRENCY;
  const rows = [];
  for (let i = 0; i < donations.length; i += concurrency) {
    const batch = donations.slice(i, i + concurrency);
    rows.push(...(await Promise.all(batch.map((d) => reconcileOne(d, { apply })))));
  }

  const counts = Object.fromEntries(Object.values(OUTCOMES).map((o) => [o, 0]));
  for (const row of rows) counts[row.outcome] += 1;

  // Pending donations older than this batch, for the next run.
  const oldest = donations.at(-1)?.createdAt ?? null;
  const remaining =
    !filter._id && donations.length === safeLimit && oldest
      ? await Donation.countDocuments({
          status: { $in: statuses },
          paymentGateway: { $in: ["razorpay", null] },
          createdAt: { $lt: oldest },
        })
      : 0;

  return {
    apply: Boolean(apply),
    checked: rows.length,
    counts,
    // Pass as `before` to continue with older donations.
    nextBefore: remaining > 0 ? oldest : null,
    remaining,
    rows,
  };
};
