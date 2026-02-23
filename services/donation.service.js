import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import Donation from "../models/donation.model.js";
import razorypay from "../config/razorypay.js";
import Payment from "../models/payment.model.js";
import Campaign from "../models/campaign.model.js";
import Campaigner from "../models/campaigner.model.js";

export const createDonationOrderService = async (req) => {
  const {
    donorName,
    donorPhone,
    amount,
    campaignId,
    campaignerId,
    email,
    isAnonymous,
    pan,
  } = req.body;

  const requiredFields = [
    "donorName",
    "donorPhone",
    "amount",
    "campaignId",
    "campaignerId",
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

  if (!mongoose.isValidObjectId(campaignId)) {
    throw new AppError(`Invalid campaignId: ${campaignId}`, 400);
  }
  if (!mongoose.isValidObjectId(campaignerId)) {
    throw new AppError(`Invalid campaignerId: ${campaignerId}`, 400);
  }

  if (isNaN(amount)) {
    throw new AppError("Amount need be a number", 400);
  }

  if (Number(amount) <= 0) {
    throw new AppError("Amount need to be greater than 0", 400);
  }

  const isExistCampaign = await Campaign.findOne({
    _id: campaignId,
    status: "active",
  });

  if (!isExistCampaign) {
    throw new AppError("Campaign not found", 404);
  }

  const isExistCampaigner = await Campaigner.findById(campaignerId);

  if (!isExistCampaigner) {
    throw new AppError("Campaigner not found", 404);
  }

  const createDonation = await Donation.create({
    donorName: isAnonymous ? "Devote" : donorName,
    donorPhone,
    amount,
    donorEmail: email,
    isAnonymous,
    campaign: campaignId,
    campaigner: campaignerId,
    status: "pending",
    pan,
  });

  const order = await razorypay.orders.create({
    amount: amount * 100,
    currency: "INR",
    receipt: createDonation._id.toString(),
  });

  await Payment.create({
    donation: createDonation._id,
    gatewayOrderId: order.id,
    amount,
    status: "created",
  });

  return {
    status: 201,
    message: "Donation order created successfully",
    resObj: {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      donationId: createDonation._id,
      key: process.env.RAZORPAY_API_KEY,
    },
  };
};
