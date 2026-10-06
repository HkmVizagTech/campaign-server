import mongoose from "mongoose";

// One row per Razorpay webhook delivery, kept 30 days, so admins can see
// whether deliveries arrive and how each was answered (Webhook health).
const webhookLogSchema = new mongoose.Schema(
  {
    receivedAt: { type: Date, default: Date.now },
    event: String,
    paymentId: String,
    orderId: String,
    // What the handler decided: ok, already_processed, ignored,
    // invalid_signature, not_configured, error_logged, accepted, ...
    outcome: String,
    httpStatus: Number,
    durationMs: Number,
    error: String,
  },
  { versionKey: false },
);

webhookLogSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const WebhookLog = mongoose.model("WebhookLog", webhookLogSchema);

export default WebhookLog;
