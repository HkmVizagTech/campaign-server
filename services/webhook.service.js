import mongoose from "mongoose";
import crypto from "crypto";
import Payment from "../models/payment.model.js";
import Donation from "../models/donation.model.js";
import WebhookLog from "../models/webhookLog.model.js";
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

// RAZORPAY_WEBHOOK_SECRET may list several secrets separated by commas, so
// the secret can be changed in Razorpay without a window of failures.
const getWebhookSecrets = () =>
  (process.env.RAZORPAY_WEBHOOK_SECRET || "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);

const signatureMatchesAny = (secrets, rawBody, receivedSignature) =>
  secrets.some((secret) =>
    isSignatureValid(
      crypto.createHmac("sha256", secret).update(rawBody).digest("hex"),
      receivedSignature,
    ),
  );

// Records how each delivery was answered once the response has been sent;
// never delays or breaks the reply.
const recordDelivery = (req, res) => {
  const startedAt = Date.now();
  res.locals.webhook = {};
  res.on("finish", () => {
    const info = res.locals.webhook || {};
    WebhookLog.create({
      receivedAt: new Date(startedAt),
      event: info.event,
      paymentId: info.paymentId,
      orderId: info.orderId,
      outcome: info.outcome,
      httpStatus: res.statusCode,
      durationMs: Date.now() - startedAt,
      error: info.error,
    }).catch((error) => console.error("Could not record webhook delivery:", error.message));
  });
};

const isSignatureValid = (expectedSignature, receivedSignature) => {
  if (!expectedSignature || !receivedSignature) {
    return false;
  }

  const expected = Buffer.from(expectedSignature, "hex");
  const received = Buffer.from(String(receivedSignature).trim(), "hex");

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

// Every delivery is answered 2xx: Razorpay disables a webhook after a day of
// failed deliveries, and nothing it could resend would fix a bad signature or
// a missing secret. Those cases are logged loudly and shown under Webhook
// health; payments they miss are still settled by /payment/verify and
// Verify pending payments.
export const razorpayWebhookService = async (req, res) => {
  recordDelivery(req, res);
  const ignore = (outcome, error) => {
    res.locals.webhook = { ...res.locals.webhook, outcome, error };
    return res.json({ status: outcome });
  };

  try {
    const secrets = getWebhookSecrets();
    const razorpaySignatureHeader = req.headers["x-razorpay-signature"];
    const razorpaySignature = Array.isArray(razorpaySignatureHeader)
      ? razorpaySignatureHeader[0]
      : razorpaySignatureHeader;
    const rawBody = getWebhookBodyBuffer(req.body);

    if (secrets.length === 0) {
      console.error("Webhook error: RAZORPAY_WEBHOOK_SECRET is not set; delivery ignored");
      return ignore("not_configured", "RAZORPAY_WEBHOOK_SECRET is not set on the server");
    }

    if (!razorpaySignature) {
      return ignore("missing_signature", "No X-Razorpay-Signature header");
    }

    if (!rawBody.length) {
      return ignore("missing_body", "Empty request body");
    }

    if (!signatureMatchesAny(secrets, rawBody, razorpaySignature)) {
      console.error(
        "Webhook error: invalid Razorpay signature — the webhook secret in Razorpay does not match RAZORPAY_WEBHOOK_SECRET",
        {
          contentType: req.headers["content-type"],
          bodyType: Buffer.isBuffer(req.body) ? "buffer" : typeof req.body,
          bodyLength: rawBody.length,
          secretsConfigured: secrets.length,
        },
      );
      return ignore(
        "invalid_signature",
        "Signature did not match: the webhook secret in Razorpay differs from RAZORPAY_WEBHOOK_SECRET",
      );
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      console.error("Webhook: signed body is not valid JSON; acknowledged");
      return ignore("ignored_malformed", "Body is not valid JSON");
    }

    const entity = event.payload?.payment?.entity;
    res.locals.webhook = {
      event: event.event,
      paymentId: entity?.id,
      orderId: entity?.order_id,
    };
    const label = `${event.event} ${entity?.id || ""}`.trim();
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
      res.locals.webhook.error = error?.message;
      if (isTransientError(error)) {
        console.error(`Webhook ${label}: database unavailable, asking Razorpay to retry:`, error);
        res.locals.webhook.outcome = "retry";
        return res.status(503).json({ status: "retry" });
      }
      console.error(`Webhook ${label}: failed, acknowledged (retrying would not help):`, error);
      res.locals.webhook.outcome = "error_logged";
      return res.json({ status: "error_logged" });
    }

    clearTimeout(timer);

    if (status === "accepted") {
      console.warn(`Webhook ${label}: still processing after ${RESPONSE_BUDGET_MS}ms; acknowledged`);
      processing
        .then((result) => console.log(`Webhook ${label}: finished in background (${result})`))
        .catch((error) => console.error(`Webhook ${label}: background processing failed:`, error));
    }

    res.locals.webhook.outcome = status;
    return res.json({ status });
  } catch (error) {
    console.error("Webhook error:", error);
    return ignore("error_logged", error?.message);
  }
};
