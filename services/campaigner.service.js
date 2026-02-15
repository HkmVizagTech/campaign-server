import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import Campaign from "../models/campaign.model.js";
import { uploadToCloudinary } from "../config/cloudinary.js";
import Media from "../models/media.model.js";
import Campaigner from "../models/campaigner.model.js";

export const createCampaignerService = async (req) => {
  const { name, campaignId, targetAmount } = req.body;

  const requiredFields = ["name", "campaignId", "targetAmount"];

  for (let field of requiredFields) {
    if (!req.body[field]) {
      throw new AppError(`${field} is required`, 400);
    }
  }

  if (Number(targetAmount) <= 0) {
    throw new AppError("Target amount must be greater than 0", 400);
  }

  if (!mongoose.isValidObjectId(campaignId)) {
    throw new AppError(`Invalid campaignId: ${campaignId}`, 400);
  }

  const campaignExist = await Campaign.findOne({
    _id: campaignId,
    status: "active",
  });

  if (!campaignExist) {
    throw new AppError(`Campaign not exist`, 404);
  }

  const exist = await Campaigner.findOne({ name, campaignId });

  if (exist) {
    throw new AppError(`Campaigner is already exists for this campaign`, 409);
  }

  if (!req.file) {
    throw new AppError("Image is required", 400);
  }

  const result = await uploadToCloudinary(req.file);

  if (!result?.secure_url || !result?.public_id) {
    throw new AppError("Image upload failed", 500);
  }

  let media = await Media.findOne({
    "image.publicId": result.public_id,
  });

  if (!media) {
    await Media.create({
      name,
      image: {
        url: result?.secure_url,
        publicId: result?.public_id,
      },
    });
  }

  const newCampaigner = await Campaigner.create({
    name,
    campaignId,
    targetAmount,
    status: "active",
    image: {
      url: result?.secure_url,
      publicId: result?.public_id,
    },
  });

  return {
    status: 201,
    message: "campaigner created successfully",
    newCampaigner,
  };
};
