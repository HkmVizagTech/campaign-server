import mongoose from "mongoose";
import Campaign from "../models/campaign.model.js";
import { AppError } from "../utils/AppError.js";

const getCampaignStatusFilter = (status) => {
  const now = new Date();

  if (status === "upcoming") {
    return { startDate: { $gt: now } };
  }

  if (status === "active") {
    return {
      startDate: { $lte: now },
      endDate: { $gte: now },
    };
  }

  if (status === "closed") {
    return { endDate: { $lt: now } };
  }

  return {};
};

const syncCampaignStatuses = async (campaigns) => {
  const campaignList = Array.isArray(campaigns) ? campaigns : [campaigns];

  const statusUpdates = campaignList
    .filter(Boolean)
    .filter((campaign) => {
      const previousStatus = campaign.status;
      campaign.calculateStatus();
      return campaign.status !== previousStatus;
    })
    .map((campaign) => ({
      updateOne: {
        filter: { _id: campaign._id },
        update: { $set: { status: campaign.status } },
      },
    }));

  if (statusUpdates.length > 0) {
    await Campaign.bulkWrite(statusUpdates);
  }
};

const YOUTUBE_ID_PATTERN =
  /(?:youtube\.com\/(?:shorts\/|watch\?(?:.*&)?v=|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

// Accepts any YouTube video/Shorts link, or "" to remove the update video.
const normalizeUpdateVideoUrl = (value) => {
  if (value == null) return "";
  if (typeof value !== "string") {
    throw new AppError("Update video must be a YouTube link", 400);
  }
  const url = value.trim();
  if (url && !YOUTUBE_ID_PATTERN.test(url)) {
    throw new AppError("Update video must be a YouTube video or Shorts link", 400);
  }
  return url;
};

export const createCampaignService = async (req) => {
  const { title, targetAmount, startDate, endDate, updateVideoUrl } = req.body;

  if (!title || !title.trim()) {
    throw new AppError("Title is required", 400);
  }

  if (targetAmount === undefined || targetAmount === null) {
    throw new AppError("Target amount is required", 400);
  }

  if (isNaN(targetAmount)) {
    throw new AppError("Target amount must be a number", 400);
  }
  if (Number(targetAmount) <= 0) {
    throw new AppError("Target amount must be greater than 0", 400);
  }
  if (!startDate) {
    throw new AppError("Start date is required", 400);
  }

  const parsedDate = new Date(startDate);
  if (isNaN(parsedDate.getTime())) {
    throw new AppError("Start date must be a valid date", 400);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsedDate.setHours(0, 0, 0, 0);

  if (parsedDate < today) {
    throw new AppError("Start date cannot be in the past", 400);
  }

  const parsedEndDate = new Date(endDate);

  if (isNaN(parsedEndDate.getTime())) {
    throw new AppError("End date must be valid date", 400);
  }
  parsedEndDate.setHours(0, 0, 0, 0);

  if (parsedEndDate <= parsedDate) {
    throw new AppError("End date must be greater than Start date", 400);
  }

  const campaign = await Campaign({
    title: title.trim(),
    targetAmount,
    startDate,
    endDate,
    updateVideoUrl: normalizeUpdateVideoUrl(updateVideoUrl),
  });

  campaign.calculateStatus();
  await campaign.save();

  return {
    status: 201,
    message: "Campaign Created Successfully",
    campaign,
  };
};

export const getCurrentCampaignService = async (req) => {
  const status = req.query.status;
  const campaign = await Campaign.findOne(getCampaignStatusFilter(status)).select(
    "-createdAt -updatedAt",
  );

  if (!campaign) {
    throw new AppError("Campaign not found", 404);
  }

  await syncCampaignStatuses(campaign);

  return {
    status: 200,
    message: "Campaign fetched successfully",
    campaign,
  };
};

export const getCampaginListService = async (req) => {
  const { search, sort, status } = req.query;
  let sortOption = { createdAt: -1 };
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 100;
  const skip = (page - 1) * pageSize;
  let filters = getCampaignStatusFilter(status);

  if (search?.trim()) {
    filters.title = { $regex: search, $options: "i" };
  }

  if (sort === "target_desc") {
    sortOption = { targetAmount: -1 };
  } else if (sort === "target_asc") {
    sortOption = { targetAmount: 1 };
  } else if (sort === "raised_desc") {
    sortOption = { raisedAmount: -1 };
  } else if (sort === "raised_asc") {
    sortOption = { raisedAmount: 1 };
  }
  const [campagins, total] = await Promise.all([
    Campaign.find(filters)
      .sort(sortOption)
      .skip(skip)
      .limit(pageSize)
      .select("-updatedAt"),
    Campaign.countDocuments(filters),
  ]);

  await syncCampaignStatuses(campagins);

  const totalPages = Math.ceil(total / pageSize);

  return {
    status: 200,
    message: "campagins fetched successfully",
    data: campagins,
    total,
    totalPages,
  };
};

export const getSingleCampaignService = async (req) => {
  const id = req.params.id;

  if (!id) {
    throw new AppError(`Id is required`, 400);
  }

  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(`Invalid ID: ${id}`, 400);
  }

  const campaign = await Campaign.findById(id);

  if (!campaign) {
    throw new AppError("Campaign not found", 404);
  }

  await syncCampaignStatuses(campaign);

  return {
    status: 200,
    message: "Single Campaign Details Fetched successfully",
    data: campaign,
  };
};

export const updateCampaignService = async (req) => {
  const id = req.params.id;

  if (!id) {
    throw new AppError("Id is required", 400);
  }

  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(`Invalid ID: ${id}`, 400);
  }

  const campaign = await Campaign.findById(id);

  if (!campaign) {
    throw new AppError("Campaign not found", 404);
  }

  const updateData = Object.fromEntries(
    Object.entries(req.body).filter(([_, value]) => value !== undefined),
  );

  delete updateData._id;
  delete updateData.startDate;

  if ("updateVideoUrl" in updateData) {
    updateData.updateVideoUrl = normalizeUpdateVideoUrl(updateData.updateVideoUrl);
  }

  if (updateData.endDate) {
    const endDate = new Date(updateData.endDate);

    if (endDate <= campaign.startDate) {
      throw new AppError("End date must be after start date", 400);
    }
  }

  if (Object.keys(updateData).length === 0) {
    throw new AppError("No fields provided for update", 400);
  }

  const updatedCampaign = await Campaign.findByIdAndUpdate(
    id,
    { $set: updateData },
    {
      returnDocument: "after",
      runValidators: true,
    },
  );

  await syncCampaignStatuses(updatedCampaign);

  return {
    status: 200,
    message: "Campaign updated successfully",
    data: updatedCampaign,
  };
};

export const deleteCampaignService = async (req) => {
  const id = req.params.id;

  if (!id) {
    throw new AppError("Id is required", 400);
  }

  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(`Invalid ID: ${id}`, 400);
  }

  const campaign = await Campaign.findById(id);

  if (!campaign) {
    throw new AppError("Campaign Not found", 404);
  }

  if (campaign.raisedAmount > 0) {
    throw new AppError(
      "Campaign cannot be deleted because donations have already been raised",
      400,
    );
  }

  await campaign.deleteOne();

  return {
    status: 200,
    message: "Campaign Deleted successfully",
    data: campaign,
  };
};
