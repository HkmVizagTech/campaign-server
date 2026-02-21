import mongoose from "mongoose";

const campaignerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    image: {
      filename: {
        type: String,
        required: true,
      },
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    targetAmount: {
      type: Number,
      required: true,
      min: 1,
    },
    raisedAmount: {
      type: Number,
      default: 0,
    },
    templeDevoteInTouch: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "close", "pending", "approved"],
      index: true,
    },
  },
  { timestamps: true, versionKey: false },
);
campaignerSchema.set("toJSON", { virtuals: true });
campaignerSchema.set("toObject", { virtuals: true });
campaignerSchema.virtual("percentage").get(function () {
  if (!this.targetAmount || this.targetAmount === 0) return 0;

  return Math.min(
    Math.round((this.raisedAmount / this.targetAmount) * 100),
    100,
  );
});

const Campaigner = mongoose.model("Campaigner", campaignerSchema);

export default Campaigner;
