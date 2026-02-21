import mongoose from "mongoose";

const mediaSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    image: {
      filename: {
        type: String,
        required: true,
        unique: true,
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const Media = mongoose.model("Media", mediaSchema);
export default Media;
