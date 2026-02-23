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
    },
    donorEmail: {
      type: String,
    },
    amount: {
      type: Number,
      required: true,
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
    pan: {
      type: String,
      uppercase: true,
      match: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
    },
    paymentGatewary: {
      type: String,
      default: "razorypay",
      immutable: true,
    },
    receiptNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const Donation = mongoose.model("Donation", donationSchema);

export default Donation;
