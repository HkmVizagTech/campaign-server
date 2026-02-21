import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import Campaign from "../models/campaign.model.js";
import Media from "../models/media.model.js";
import Campaigner from "../models/campaigner.model.js";
import { getSignedImageUrl, uploadToGCS } from "../utils/GCS.js";
import TempleDevote from "../models/templeDevote.model.js";

export const createCampaignerService = async (req) => {
  const {
    name,
    campaignId,
    targetAmount,
    imageId,
    phoneNumber,
    templeDevoteInTouch,
  } = req.body;

  const requiredFields = [
    "name",
    "campaignId",
    "targetAmount",
    "phoneNumber",
    "templeDevoteInTouch",
  ];

  for (let field of requiredFields) {
    if (
      req.body[field] === undefined ||
      req.body[field] === null ||
      req.body[field] === ""
    ) {
      throw new AppError(`${field} is required`, 400);
    }
  }

  if (!mongoose.isValidObjectId(templeDevoteInTouch)) {
    throw new AppError(`Invalid Devote ID: ${templeDevoteInTouch}`, 400);
  }

  const templeDevote = await TempleDevote.findById(templeDevoteInTouch);

  if (!templeDevote) {
    throw new AppError("TempleDevote not found", 404);
  }

  if (Number(targetAmount) <= 0) {
    throw new AppError("Target amount must be greater than 0", 400);
  }

  if (!mongoose.isValidObjectId(campaignId)) {
    throw new AppError(`Invalid campaignId: ${campaignId}`, 400);
  }

  const campaignExist = await Campaign.findOne({
    _id: campaignId,
    status: {
      $ne: "closed",
    },
  });

  if (!campaignExist) {
    throw new AppError(`Campaign not exist`, 404);
  }

  const exist = await Campaigner.findOne({ name, campaignId });

  if (exist) {
    throw new AppError(`Campaigner is already exists for this campaign`, 409);
  }

  let imageResult;

  if (imageId) {
    if (!mongoose.isValidObjectId(imageId)) {
      throw new AppError(`Invalid imageId: ${imageId}`, 400);
    }

    const media = await Media.findById(imageId);

    if (!media) {
      throw new AppError(`Image not found for this ID: ${imageId}`, 404);
    }

    imageResult = {
      filename: media.image.filename,
    };
  } else {
    if (!req.file) {
      throw new AppError(`Image File is required`, 400);
    }

    const uploadResult = await uploadToGCS(req.file);

    if (!uploadResult.filename) {
      throw new AppError(`Image upload failed`, 500);
    }

    const media = await Media.create({
      name,
      image: {
        filename: uploadResult?.filename,
      },
    });

    imageResult = {
      filename: media.image.filename,
    };
  }
  const imageUrl = await getSignedImageUrl(imageResult.filename);
  const newCampaigner = await Campaigner.create({
    name,
    phoneNumber,
    campaignId,
    templeDevoteInTouch,
    targetAmount,
    status: "active",
    image: {
      filename: imageResult?.filename,
    },
  });

  return {
    status: 201,
    message: "campaigner created successfully",
    newCampaigner: {
      ...newCampaigner.toObject(),
      image: {
        url: imageUrl,
      },
    },
  };
};
