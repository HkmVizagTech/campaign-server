import mongoose from "mongoose";

const donationSchema = new mongoose.Schema(
  {
    donorName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    donorPhone: {
      type: String,
      required: true,
      index: true,
    },
    donorEmail: {
      type: String,
    },
    amount: {
      type: Number,
      required: true,
      index: true,
    },
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
    },
    campaigner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaigner",
    },
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      index: true,
    },
    isAnonymous: {
      type: Boolean,
      default: false,
    },
    address: {
      fullAddress: String,
      state: String,
      city: String,
      pincode: String,
    },
    prasadam: {
      type: Boolean,
      default: false,
    },
    seva: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seva",
      index: true,
      default: null,
    },
    pan: {
      type: String,
      uppercase: true,
      match: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
    },
    paymentGateway: {
      type: String,
      default: "razorpay",
      immutable: true,
    },
    receiptNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    gatewayPaymentId: {
      type: String,
      unique: true,
      sparse: true,
    },
    dccDataSentAt: Date,
    dccApiResponse: Object,
    dccRequestPayload: Object,
  },
  {
    timestamps: true,
    versionKey: false,
  },
);
donationSchema.index({
  campaign: 1,
  campaigner: 1,
  status: 1,
  amount: -1,
});

const Donation = mongoose.model("Donation", donationSchema);

export default Donation;
