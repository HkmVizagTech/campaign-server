import Campaign from "../models/campaign.model.js";
import { AppError } from "../utils/AppError.js";

export const createCampaignService = async (req) => {
  const { title, targetAmount, startDate, endDate } = req.body;

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
  });

  campaign.calculateStatus();
  await campaign.save();

  return {
    status: 201,
    message: "Campaign Created Successfully",
    campaign,
  };
};
