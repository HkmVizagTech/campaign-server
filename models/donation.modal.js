import mongoose from "mongoose";

const donationSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    campaignerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaigner",
      required: true,
      index: true,
    },
    fullname: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
    },
    phoneNumber: {
      type: String,
      required: true,
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
    amount: {
      type: Number,
      required: true,
    },

    paymentId: String,
    paymentStatus: {
      type: String,
      enum: ["pending", "success", "failed", "refunded"],
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const Donation = mongoose.model("Donation", donationSchema);

export default Donation;
