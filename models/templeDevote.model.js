import mongoose from "mongoose";

const templeDevoteSchema = new mongoose.Schema(
  {
    devoteName: {
      type: String,
      required: true,
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const TempleDevote = mongoose.model("TempleDevote", templeDevoteSchema);

export default TempleDevote;