import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import Campaign from "../models/campaign.model.js";
import Media from "../models/media.model.js";
import Campaigner from "../models/campaigner.model.js";
import { getSignedImageUrl, uploadToGCS } from "../utils/GCS.js";
import TempleDevote from "../models/templeDevote.model.js";
import { attachImageUrl } from "../utils/attachImageUrls.js";

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

export const getCampaignerService = async (req) => {
  const campId = req.params.campaignId;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 12;
  const skip = (page - 1) * pageSize;
  const status = req.query.status;

  if (!mongoose.isValidObjectId(campId)) {
    throw new AppError(`Invalid campaginId: ${campId}`);
  }

  const campaign = await Campaign.findOne({
    _id: campId,
    status,
  });

  if (!campaign) {
    throw new AppError(`Campaign not found`, 404);
  }

  const obj = {
    campaignId: campId,
    status: "active",
  };

  if (req.query.search) {
    obj.name = {
      $regex: req.query.search,
      $options: "i",
    };
  }

  const campaigners = await Campaigner.find(obj)
    .populate("templeDevoteInTouch")
    .populate("campaignId")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(pageSize)
    .lean();

  const campaignersWithImages = await attachImageUrl(campaigners);
  const totalCampaigners = await Campaigner.countDocuments({
    campaignId: campId,
    status: "active",
  });

  return {
    status: 200,
    message: "Fetched campaigners successfully.",
    campaigners: campaignersWithImages,
    count: totalCampaigners,
  };
};
