import express from "express";
import {
  cardSummary,
  devoteeReport,
  donationTrend,
  prasadamReport,
} from "../controllers/dashboard.controller.js";
import { verifyToken } from "../middlewares/verifyToken.middleware.js";
import { authorizeRole } from "../middlewares/onlyAdmin.middleware.js";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";
import { capturePaymentService } from "../services/payment.service.js";
import Donation from "../models/donation.model.js";
import Payment from "../models/payment.model.js";
import Campaign from "../models/campaign.model.js";
import Campaigner from "../models/campaigner.model.js";
import mongoose from "mongoose";

import razorpay from "../config/razorpay.js";

const dashboardRouter = express.Router();

dashboardRouter.get("/summary", verifyToken, authorizeRole("admin", "devotee"), cardSummary);
dashboardRouter.get("/donation-trend", verifyToken, authorizeRole("admin", "devotee"), donationTrend);
dashboardRouter.get("/reports/devotee-summary", verifyToken, authorizeRole("admin", "superAdmin"), devoteeReport);
dashboardRouter.get("/reports/prasadam", verifyToken, authorizeRole("admin", "superAdmin"), prasadamReport);

dashboardRouter.post(
  "/correct-mismatched-donation",
  verifyToken,
  authorizeRole("admin", "superAdmin"),
  asyncHandlers(async (req, res) => {
    const { donationId } = req.body;

    if (!donationId || !mongoose.isValidObjectId(donationId)) {
      return response(res, 400, "Valid donationId is required");
    }

    const donation = await Donation.findById(donationId);
    if (!donation) {
      return response(res, 404, "Donation not found");
    }
    if (donation.status !== "success") {
      return response(res, 400, "Only 'success' donations can be corrected here", {
        currentStatus: donation.status,
      });
    }

    // Re-verify with Razorpay one more time right before correcting,
    // so we never reverse a donation that's actually fine — and never
    // reverse one just because of a network blip on our side either.
    let livePayment;
    try {
      livePayment = await razorpay.payments.fetch(donation.gatewayPaymentId);
    } catch (err) {
      const statusCode = err?.statusCode || err?.status;
      const razorpayCode = err?.error?.code;
      const isGenuineNotFound =
        (statusCode === 400 || statusCode === 404) &&
        (razorpayCode === "BAD_REQUEST_ERROR" ||
          err?.error?.description?.toLowerCase().includes("does not exist"));

      if (isGenuineNotFound) {
        // A payment ID that genuinely doesn't exist on Razorpay is almost
        // always OUR data problem (wrong API key/mode, corrupted ID) —
        // it is NOT proof the donation itself was fake. Refuse to
        // auto-reverse; this needs a human to check the Razorpay
        // dashboard directly and the RAZORPAY_API_KEY/KEY_SECRET mode
        // (test vs live) before anything is touched.
        return response(
          res,
          409,
          `Razorpay has no record of payment ${donation.gatewayPaymentId}. This usually means a test/live API key mismatch or a data issue on our side — NOT proof the donation is invalid. Please verify manually in the Razorpay dashboard before taking any action. No changes were made.`,
        );
      }

      // Rate limit, timeout, or auth issue — refuse to touch the
      // donation rather than risk reversing a valid one incorrectly.
      return response(
        res,
        503,
        `Could not verify with Razorpay right now (${err?.error?.description || err.message}). Please try again — no changes were made.`,
      );
    }

    if (livePayment.status === "captured" || livePayment.status === "authorized") {
      return response(res, 200, "Razorpay now confirms this payment is captured — no correction needed", {
        razorpayStatus: livePayment.status,
      });
    }

    // Reverse the raised amount exactly as it was added, then mark failed.
    if (donation.campaign) {
      await Campaign.findByIdAndUpdate(donation.campaign, {
        $inc: { raisedAmount: -donation.amount },
      });
    }
    if (donation.campaigner) {
      await Campaigner.findByIdAndUpdate(donation.campaigner, {
        $inc: { raisedAmount: -donation.amount },
      });
    }

    donation.status = "failed";
    await donation.save();

    await Payment.findOneAndUpdate(
      { donation: donation._id },
      { status: "failed" },
    );

    response(res, 200, "Donation corrected: marked failed and raised amount reversed", {
      donationId: donation._id,
      amountReversed: donation.amount,
      razorpayStatus: livePayment?.status || "not_found",
    });
  }),
);

dashboardRouter.get(
  "/audit-donations",
  verifyToken,
  authorizeRole("admin", "superAdmin"),
  asyncHandlers(async (req, res) => {
    const { fromDate, toDate, limit = 100 } = req.query;
    const safeLimit = Math.min(Number(limit) || 100, 300);

    const filter = { status: "success", gatewayPaymentId: { $exists: true, $ne: null } };
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }

    const donations = await Donation.find(filter)
      .select("donorName donorPhone amount gatewayPaymentId createdAt campaigner receiptNumber")
      .populate("campaigner", "name")
      .sort({ createdAt: -1 })
      .limit(safeLimit);

    const mismatches = [];
    let checked = 0;
    const errors = [];

    const fetchWithRetry = async (paymentId, attempt = 1) => {
      try {
        return await razorpay.payments.fetch(paymentId);
      } catch (err) {
        const statusCode = err?.statusCode || err?.status;
        const razorpayCode = err?.error?.code;

        // A genuine "no such payment" is a 400/404 with BAD_REQUEST_ERROR
        // and a description mentioning the id — this is the only case
        // that should ever be treated as a real mismatch.
        const isGenuineNotFound =
          (statusCode === 400 || statusCode === 404) &&
          (razorpayCode === "BAD_REQUEST_ERROR" ||
            err?.error?.description?.toLowerCase().includes("does not exist"));

        if (isGenuineNotFound) {
          const notFoundError = new Error("Payment does not exist on Razorpay");
          notFoundError.isGenuineNotFound = true;
          throw notFoundError;
        }

        // Anything else (network blip, rate limit 429, timeout, auth issue)
        // is transient/infrastructure — retry a couple of times before
        // giving up, and never label it as "not found".
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 300 * attempt));
          return fetchWithRetry(paymentId, attempt + 1);
        }

        const transientError = new Error(
          `Could not verify with Razorpay after ${attempt} attempts: ${err?.error?.description || err.message}`,
        );
        transientError.isTransient = true;
        throw transientError;
      }
    };

    const checkOne = async (donation) => {
      try {
        const livePayment = await fetchWithRetry(donation.gatewayPaymentId);
        checked++;
        if (livePayment.status !== "captured" && livePayment.status !== "authorized") {
          return {
            donationId: donation._id,
            donorName: donation.donorName,
            amount: donation.amount,
            campaigner: donation.campaigner?.name,
            receiptNumber: donation.receiptNumber,
            gatewayPaymentId: donation.gatewayPaymentId,
            razorpayStatus: livePayment.status,
            createdAt: donation.createdAt,
          };
        }
        return null;
      } catch (err) {
        if (err.isGenuineNotFound) {
          return {
            donationId: donation._id,
            donorName: donation.donorName,
            amount: donation.amount,
            campaigner: donation.campaigner?.name,
            receiptNumber: donation.receiptNumber,
            gatewayPaymentId: donation.gatewayPaymentId,
            razorpayStatus: "NEEDS_MANUAL_CHECK_NOT_ON_RAZORPAY",
            needsManualCheck: true,
            createdAt: donation.createdAt,
          };
        }

        // Transient failure — don't flag it as a mismatch, surface it
        // separately so it can be re-checked, not mistaken for fraud.
        errors.push({
          donationId: donation._id,
          donorName: donation.donorName,
          gatewayPaymentId: donation.gatewayPaymentId,
          error: err.message,
        });
        return null;
      }
    };

    // Check in batches of 10 in parallel — Razorpay API is fast enough
    // for this, and it keeps the whole audit well under a minute even
    // for a few hundred donations.
    const BATCH_SIZE = 10;
    for (let i = 0; i < donations.length; i += BATCH_SIZE) {
      const batch = donations.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(checkOne));
      mismatches.push(...results.filter(Boolean));
    }

    response(res, 200, "Audit complete", {
      totalChecked: checked,
      totalMismatches: mismatches.length,
      mismatches,
      transientErrors: errors,
    });
  }),
);

dashboardRouter.get(
  "/donations-with-order-id-as-payment-id",
  verifyToken,
  authorizeRole("admin", "superAdmin"),
  asyncHandlers(async (req, res) => {
    // Finds every donation where gatewayPaymentId was wrongly stored
    // as an order ID (starts with "order_") instead of a real payment
    // ID (starts with "pay_"). These are exactly the records that
    // could have been marked success without ever being verified
    // against a real Razorpay payment.
    const affected = await Donation.find({
      gatewayPaymentId: { $regex: /^order_/ },
    })
      .populate("campaigner", "name slug")
      .sort({ createdAt: -1 })
      .select(
        "donorName donorPhone donorEmail amount status createdAt campaigner receiptNumber gatewayPaymentId",
      );

    response(res, 200, "Donations with order ID stored as payment ID", affected);
  }),
);

dashboardRouter.get(
  "/pending-donations",
  verifyToken,
  authorizeRole("admin", "superAdmin"),
  asyncHandlers(async (req, res) => {
    const unresolved = await Donation.find({
      status: { $in: ["pending", "failed"] },
    })
      .populate("campaigner", "name slug")
      .sort({ createdAt: -1 })
      .limit(100)
      .select("donorName donorPhone amount status createdAt campaigner");

    response(res, 200, "Pending/failed donations fetched", unresolved);
  }),
);

dashboardRouter.get(
  "/donation-lookup/:donationId",
  verifyToken,
  authorizeRole("admin", "superAdmin"),
  asyncHandlers(async (req, res) => {
    const { donationId } = req.params;

    if (!mongoose.isValidObjectId(donationId)) {
      return response(res, 400, "Invalid donationId");
    }

    const donation = await Donation.findById(donationId)
      .populate("campaigner", "name slug")
      .select(
        "donorName donorPhone donorEmail amount status createdAt campaigner receiptNumber gatewayPaymentId",
      );

    if (!donation) {
      return response(res, 404, "Donation not found");
    }

    const paymentDoc = await Payment.findOne({
      donation: donation._id,
    }).select("gatewayOrderId status");

    response(res, 200, "Donation found", { donation, payment: paymentDoc });
  }),
);

dashboardRouter.post(
  "/reconcile-donation",
  verifyToken,
  authorizeRole("admin", "superAdmin"),
  asyncHandlers(async (req, res) => {
    const { donationId, paymentId } = req.body;

    if (!donationId || !paymentId) {
      return response(res, 400, "donationId and paymentId are required");
    }
    if (!mongoose.isValidObjectId(donationId)) {
      return response(res, 400, "Invalid donationId");
    }

    // Hard guard: never allow an order_xxx ID to be used where a
    // payment_id is required. This was the exact mistake that let
    // failed transactions get recorded as successful — receipts
    // created and WhatsApp sent for payments that never actually
    // succeeded. A Razorpay payment ID always starts with "pay_".
    if (!/^pay_[A-Za-z0-9]+$/.test(paymentId.trim())) {
      return response(
        res,
        400,
        `"${paymentId}" is not a valid Razorpay payment ID. It must start with "pay_" — never use the order ID (starts with "order_") here.`,
      );
    }

    const donation = await Donation.findById(donationId);
    if (!donation) {
      return response(res, 404, "Donation not found");
    }
    if (donation.status === "success") {
      return response(res, 200, "Donation already captured", { status: donation.status });
    }

    const paymentDoc = await Payment.findOne({ donation: donation._id });
    if (!paymentDoc?.gatewayOrderId) {
      return response(res, 404, "Payment record not found for this donation");
    }

    const result = await capturePaymentService({
      gatewayOrderId: paymentDoc.gatewayOrderId,
      gatewayPaymentId: paymentId,
      rawResponse: { id: paymentId, order_id: paymentDoc.gatewayOrderId },
      donationId: donation._id.toString(),
    });

    const updated = await Donation.findById(donationId).select(
      "status receiptNumber dccDataSentAt amount donorName",
    );

    response(res, 200, result.message, updated);
  }),
);

export default dashboardRouter;
