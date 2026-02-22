import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    donation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Donation",
      required: true,
      index: true,
    },
    gateway: {
      type: String,
      default: "razorpay",
      immutable: true,
    },

    gatewayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    gatewayPaymentId: {
      type: String,
    },
    gatewaySignature: {
      type: String,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    currency: {
      type: String,
      default: "INR",
    },
    status: {
      type: String,
      enum: ["created", "authorized", "captured", "failed"],
      default: "created",
    },
    rawResponse: {
      type: Object,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;
