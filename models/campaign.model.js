import mongoose from "mongoose";

const campaignSchema = new mongoose.Schema(
  {
    title: {
      type: String,
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

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ["upcoming", "active", "closed"],
      default: "upcoming",
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);
campaignSchema.set("toJSON", { virtuals: true });
campaignSchema.set("toObject", { virtuals: true });


campaignSchema.virtual("percentage").get(function () {
  if (!this.targetAmount || this.targetAmount === 0) return 0;

  return Math.min(
    Math.round((this.raisedAmount / this.targetAmount) * 100),
    100
  );
});

campaignSchema.pre("save", function (next) {
  const now = new Date();

  if (now < this.startDate) {
    this.status = "upcoming";
  } else if (now >= this.startDate && now <= this.endDate) {
    this.status = "active";
  } else {
    this.status = "closed";
  }

  next();
});

const Campaign = mongoose.model("Campaign", campaignSchema);

export default Campaign;
