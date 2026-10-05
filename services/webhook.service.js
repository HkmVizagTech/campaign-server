import mongoose from "mongoose";
import crypto from "crypto";
import Payment from "../models/payment.model.js";
import Donation from "../models/donation.model.js";
import { capturePaymentService } from "./payment.service.js";

const getWebhookBodyBuffer = (body) => {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (typeof body === "string") {
    return Buffer.from(body);
  }

  if (body && typeof body === "object") {
    // Body arrived as parsed JSON instead of raw Buffer — middleware likely bypassed.
    // Returning empty buffer so the signature check fails cleanly with a 400,
    // rather than silently computing HMAC on re-serialised JSON (wrong key order).
    console.error(
      "Webhook body is a parsed object, not a raw Buffer — check bodyParser.raw() middleware order",
    );
    return Buffer.from("");
  }

  return Buffer.from("");
};

const isSignatureValid = (expectedSignature, receivedSignature) => {
  if (!expectedSignature || !receivedSignature) {
    return false;
  }

  const expected = Buffer.from(expectedSignature, "hex");
  const received = Buffer.from(receivedSignature, "hex");

  if (expected.length !== received.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, received);
};

// Razorpay marks a delivery failed unless it gets a 2xx within 5 seconds,
// and disables the webhook after 24 hours of failures. Anything slower than
// this is acknowledged and finishes in the background; a donation that still
// ends up unsettled is picked up by Verify pending payments.
const RESPONSE_BUDGET_MS = 4000;

// Only a database outage is worth a Razorpay retry; every other error
// (bad data, duplicate key, code bug) would fail the same way again.
const isTransientError = (error) =>
  /^Mongo(Network|ServerSelection|NotConnected|Pool)/.test(error?.name || "") ||
  error?.name === "MongooseServerSelectionError" ||
  /buffering timed out/i.test(error?.message || "");

const handleEvent = async (event) => {
  if (event.event === "payment.captured") {
    const payment = event.payload?.payment?.entity;
    if (!payment?.id || !payment?.order_id) return "ignored_malformed";

    try {
      const result = await capturePaymentService({
        gatewayOrderId: payment.order_id,
        gatewayPaymentId: payment.id,
        rawResponse: payment,
        donationId: payment.notes?.donationId,
        trustedPaymentStatus: payment.status,
        deferPostCapture: true,
      });

      return result.message === "Payment already processed"
        ? "already_processed"
        : "ok";
    } catch (error) {
      if (error?.statusCode === 404) {
        // Usually another app's payment on the shared Razorpay account.
        console.error(
          `Webhook payment.captured: ${error.message} — orderId: ${payment.order_id}, paymentId: ${payment.id}, donationId: ${payment.notes?.donationId}. Use Verify pending payments if this is ours.`,
        );
        return "not_found_logged";
      }
      if (error?.statusCode === 400) {
        // Re-verification said it wasn't actually captured (e.g. refunded
        // moments later); already marked failed inside capturePaymentService.
        console.error(
          `Webhook payment.captured: verification failed — ${error.message}`,
        );
        return "verification_failed_logged";
      }
      throw error;
    }
  }

  if (event.event === "payment.failed") {
    const payment = event.payload?.payment?.entity;
    if (!payment?.order_id) return "ignored_malformed";
    const donationId = payment.notes?.donationId;

    await Payment.findOneAndUpdate(
      { gatewayOrderId: payment.order_id, status: { $ne: "captured" } },
      { status: "failed", rawResponse: payment },
    );

    // Other apps share this Razorpay account, so donationId in notes may
    // not be one of ours (or not an ObjectId at all) — never let that 500.
    if (donationId && mongoose.isValidObjectId(donationId)) {
      await Donation.findOneAndUpdate(
        { _id: donationId, status: { $ne: "success" } },
        { status: "failed" },
      );
    }

    return "ok";
  }

  return "ignored";
};

export const razorpayWebhookService = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    const razorpaySignatureHeader = req.headers["x-razorpay-signature"];
    const razorpaySignature = Array.isArray(razorpaySignatureHeader)
      ? razorpaySignatureHeader[0]
      : razorpaySignatureHeader;
    const rawBody = getWebhookBodyBuffer(req.body);

    if (!secret) {
      console.error("Webhook error: missing RAZORPAY_WEBHOOK_SECRET");
      return res.status(500).send("Webhook secret not configured");
    }

    if (!razorpaySignature) {
      return res.status(400).send("Missing Razorpay signature");
    }

    if (!rawBody.length) {
      return res.status(400).send("Missing webhook body");
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    if (!isSignatureValid(expectedSignature, razorpaySignature)) {
      console.error("Webhook error: invalid Razorpay signature", {
        contentType: req.headers["content-type"],
        bodyType: Buffer.isBuffer(req.body) ? "buffer" : typeof req.body,
        bodyLength: rawBody.length,
        secretLength: secret.length,
        expectedSignaturePrefix: expectedSignature.substring(0, 8) + "...",
        receivedSignaturePrefix: razorpaySignature.substring(0, 8) + "...",
      });
      return res.status(400).send("Invalid signature");
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      console.error("Webhook: signed body is not valid JSON; acknowledged");
      return res.json({ status: "ignored_malformed" });
    }

    const label = `${event.event} ${event.payload?.payment?.entity?.id || ""}`.trim();
    const processing = handleEvent(event);
    let timer;
    const budget = new Promise((resolve) => {
      timer = setTimeout(() => resolve("accepted"), RESPONSE_BUDGET_MS);
    });

    let status;
    try {
      status = await Promise.race([processing, budget]);
    } catch (error) {
      clearTimeout(timer);
      if (isTransientError(error)) {
        console.error(`Webhook ${label}: database unavailable, asking Razorpay to retry:`, error);
        return res.status(503).json({ status: "retry" });
      }
      console.error(`Webhook ${label}: failed, acknowledged (retrying would not help):`, error);
      return res.json({ status: "error_logged" });
    }

    clearTimeout(timer);

    if (status === "accepted") {
      console.warn(`Webhook ${label}: still processing after ${RESPONSE_BUDGET_MS}ms; acknowledged`);
      processing
        .then((result) => console.log(`Webhook ${label}: finished in background (${result})`))
        .catch((error) => console.error(`Webhook ${label}: background processing failed:`, error));
    }

    return res.json({ status });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ status: "error_logged" });
  }
};
