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
        secretFirstChars: secret.substring(0, 4) + "...",
        expectedSignaturePrefix: expectedSignature.substring(0, 8) + "...",
        receivedSignaturePrefix: razorpaySignature.substring(0, 8) + "...",
      });
      return res.status(400).send("Invalid signature");
    }

    const event = JSON.parse(rawBody.toString("utf8"));

    if (event.event === "payment.captured") {
      const payment = event.payload.payment.entity;
      const result = await capturePaymentService({
        gatewayOrderId: payment.order_id,
        gatewayPaymentId: payment.id,
        rawResponse: payment,
        donationId: payment.notes?.donationId,
      });

      return res.json({
        status:
          result.message === "Payment already processed"
            ? "already_processed"
            : "ok",
      });
    }

    if (event.event === "payment.failed") {
      const payment = event.payload.payment.entity;
      const donationId = payment.notes?.donationId;

      await Payment.findOneAndUpdate(
        { gatewayOrderId: payment.order_id, status: { $ne: "captured" } },
        { status: "failed", rawResponse: payment },
      );

      if (donationId) {
        await Donation.findOneAndUpdate(
          { _id: donationId, status: { $ne: "success" } },
          { status: "failed" },
        );
      }

      return res.json({ status: "ok" });
    }

    return res.json({ status: "ok" });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ status: "error_logged" });
  }
};
