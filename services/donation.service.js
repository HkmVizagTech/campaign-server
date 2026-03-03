import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import Donation from "../models/donation.model.js";
import razorpay from "../config/razorpay.js";
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
    sevaId,
    address,
    pincode,
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

  if (isNaN(Number(amount))) {
    throw new AppError("Amount need be a number", 400);
  }

  if (Number(amount) <= 0) {
    throw new AppError("Amount need to be greater than 0", 400);
  }

  if (sevaId) {
    if (!mongoose.isValidObjectId(sevaId)) {
      throw new AppError(`Invalid SevaID: ${sevaId}`);
    }
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
    amount: Number(amount),
    donorEmail: email,
    isAnonymous,
    campaign: campaignId,
    campaigner: campaignerId,
    status: "pending",
    seva: sevaId,
    pan,
    pincode,
    address,
  });

  const order = await razorpay.orders.create({
    amount: amount * 100,
    currency: "INR",
    receipt: createDonation._id.toString(),
    notes: {
      donationId: createDonation._id.toString(),
    },
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

export const getDonorsService = async (req) => {
  const { id, campId, search } = req.query;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 15;

  let filter = {
    status: "success",
  };

  if (id) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(`Invalid Id: ${id}`);
    }

    filter.campaigner = id;
  }

  if (campId) {
    if (!mongoose.isValidObjectId(campId)) {
      throw new AppError(`Invalid Id: ${campId}`);
    }

    filter.campaign = campId;
  }

  if (search?.trim()) {
    const searchRegex = new RegExp(search.trim(), "i");

    filter.$or = [
      { donorName: searchRegex },
      { donorPhone: searchRegex },
      { receiptNumber: searchRegex },
    ];
  }

  const skip = (page - 1) * pageSize;

  const donors = await Donation.find(filter)
    .populate({
      path: "campaign",
      select: "-updatedAt",
    })
    .populate({
      path: "campaigner",
      select: "-createdAt -updatedAt",
      populate: {
        path: "templeDevoteInTouch",
        select: "-createdAt -updatedAt",
      },
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(pageSize)
    .select("-createdAt -updatedAt");
  const total = await Donation.countDocuments(filter);

  return {
    status: 200,
    message: "Donors Fetched successfully",
    data: donors,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / pageSize),
    },
  };
};
