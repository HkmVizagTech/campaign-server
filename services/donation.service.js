import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import Donation from "../models/donation.model.js";
import razorpay from "../config/razorpay.js";
import Payment from "../models/payment.model.js";
import Campaign from "../models/campaign.model.js";
import Campaigner from "../models/campaigner.model.js";
import TempleDevote from "../models/templeDevote.model.js";

export const createDonationOrderService = async (req) => {
  const {
    donorName,
    donorPhone,
    amount,
    campaignId,
    slug,
    email,
    isAnonymous,
    pan,
    sevaId,
    address,
    prasadam,
  } = req.body;

  const requiredFields = [
    "donorName",
    "donorPhone",
    "amount",
    "campaignId",
    "slug",
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

  if (isNaN(Number(amount))) {
    throw new AppError("Amount need be a number", 400);
  }

  if (Number(amount) <= 0) {
    throw new AppError("Amount need to be greater than 0", 400);
  }

  if (sevaId) {
    if (!mongoose.isValidObjectId(sevaId)) {
      throw new AppError(`Invalid SevaID: ${sevaId}`, 400);
    }
  }

  if (address && Object.keys(address).length > 0) {
    const requiredFields = ["fullAddress", "pincode", "city", "state"];
    const missingField = requiredFields.find((field) => !address[field]);
    if (missingField) {
      throw new AppError(`${missingField} is required`, 400);
    }
  }

  const isExistCampaign = await Campaign.findOne({
    _id: campaignId,
    status: "active",
  });

  if (!isExistCampaign) {
    throw new AppError("Campaign not found", 404);
  }

  const isExistCampaigner = await Campaigner.findOne({ slug: slug });

  if (!isExistCampaigner) {
    throw new AppError("Campaigner not found", 404);
  }

  const createDonation = await Donation.create({
    donorName: donorName,
    donorPhone,
    amount: Number(amount),
    donorEmail: email,
    isAnonymous,
    campaign: campaignId,
    campaigner: isExistCampaigner._id,
    status: "pending",
    seva: sevaId,
    pan,
    address,
    prasadam,
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
  const { id, campId, search, sevaId } = req.query;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 15;
  const isPrasadam = req.query.isPrasadam === "true";
  const role = req?.user?.role;
  const userId = req?.user?.id;

  if (!role || !userId) {
    throw new AppError("Unauthorized user", 401);
  }
  let filter = {
    status: "success",
  };

  if (role === "admin") {
    if (id) {
      if (!mongoose.isValidObjectId(id)) {
        throw new AppError(`Invalid Id: ${id}`, 400);
      }
      filter.campaigner = id;
    }
  }

  if (role === "devotee") {
    const devotee = await TempleDevote.findOne({ userId });
    if (!devotee) {
      throw new AppError("Devotee Not found", 404);
    }

    const campaigners = await Campaigner.find({
      templeDevoteInTouch: devotee._id,
    }).select("_id");

    const campaignerIds = campaigners.map((c) => c._id);

    if (!campaignerIds.length) {
      return {
        status: 200,
        data: [],
        pagination: { total: 0 },
      };
    }

    if (id) {
      if (!mongoose.isValidObjectId(id)) {
        throw new AppError(`Invalid Id: ${id}`, 400);
      }

      if (!campaignerIds.some((c) => c.toString() === id)) {
        throw new AppError("Access denied to this campaigner", 403);
      }

      filter.campaigner = id;
    } else {
      filter.campaigner = { $in: campaignerIds };
    }
  }

  if (campId) {
    if (!mongoose.isValidObjectId(campId)) {
      throw new AppError(`Invalid Id: ${campId}`, 400);
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

  if (sevaId) {
    filter.seva = sevaId;
  }

  if (isPrasadam) {
    filter.prasadam = true;
    filter.amount = { $gte: 999 };
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

export const getDonorDetailsService = async (req) => {
  const donationId = req?.params?.donationId;

  if (!donationId) {
    throw new AppError("Donation Id is required", 400);
  }

  if (!mongoose.isValidObjectId(donationId)) {
    throw new AppError(`Invalid DonationId: ${donationId}`, 400);
  }

  const details = await Donation.findById(donationId).populate({
    path: "seva",
    select: "-createdAt -updatedAt",
  });

  if (!details) {
    throw new AppError("No donation found", 404);
  }

  const isEligibleForPrasadam =
    details.amount >= 999 &&
    details.prasadam &&
    details.address &&
    Object.keys(details.address).length > 0;

  return {
    status: 200,
    message: "Donation details fetched successfully",
    data: {
      ...details.toObject(),
      isEligibleForPrasadam,
    },
  };
};
