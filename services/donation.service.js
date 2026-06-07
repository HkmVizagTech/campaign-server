import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import Donation from "../models/donation.model.js";
import razorpay from "../config/razorpay.js";
import Payment from "../models/payment.model.js";
import Campaign from "../models/campaign.model.js";
import Campaigner from "../models/campaigner.model.js";
import TempleDevote from "../models/templeDevote.model.js";
import {
  syncDonationWithDcc,
  sendDonationNotifications,
} from "./payment.service.js";

const PENDING_DONATION_REUSE_WINDOW_MINUTES = 30;

const buildPendingDonationReuseFilter = ({
  donorPhone,
  amount,
  campaignId,
  campaignerId,
  sevaId,
  prasadam,
}) => ({
  donorPhone,
  amount: Number(amount),
  campaign: campaignId,
  campaigner: campaignerId,
  status: "pending",
  seva: sevaId ? new mongoose.Types.ObjectId(sevaId) : null,
  prasadam: Boolean(prasadam),
  createdAt: {
    $gte: new Date(
      Date.now() - PENDING_DONATION_REUSE_WINDOW_MINUTES * 60 * 1000,
    ),
  },
});

const buildDonationPayload = ({
  donorName,
  donorPhone,
  amount,
  email,
  isAnonymous,
  campaignId,
  campaignerId,
  sevaId,
  pan,
  address,
  prasadam,
}) => ({
  donorName,
  donorPhone,
  amount: Number(amount),
  donorEmail: email,
  isAnonymous,
  campaign: campaignId,
  campaigner: campaignerId,
  status: "pending",
  seva: sevaId ? sevaId : null,
  pan,
  address,
  prasadam,
  gatewayPaymentId: undefined,
  dccDataSentAt: undefined,
  dccApiResponse: undefined,
  receiptNumber: undefined,
});

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

  const isExistCampaigner = await Campaigner.findOne({
    slug: slug,
    campaignId,
  });

  if (!isExistCampaigner) {
    throw new AppError("Campaigner not found", 404);
  }

  const donationPayload = buildDonationPayload({
    donorName,
    donorPhone,
    amount,
    email,
    isAnonymous,
    campaignId,
    campaignerId: isExistCampaigner._id,
    sevaId,
    pan,
    address,
    prasadam,
  });
  const reusableDonation = await Donation.findOne(
    buildPendingDonationReuseFilter({
      donorPhone,
      amount,
      campaignId,
      campaignerId: isExistCampaigner._id,
      sevaId,
      prasadam,
    }),
  ).sort({ createdAt: -1 });

  const createDonation = reusableDonation
    ? await Donation.findByIdAndUpdate(reusableDonation._id, donationPayload, {
        returnDocument: "after",
      })
    : await Donation.create(donationPayload);
  const isReusedDonation = Boolean(reusableDonation);
  let order;

  try {
    order = await razorpay.orders.create({
      amount: Number(amount) * 100,
      currency: "INR",
      receipt: createDonation._id.toString(),
      notes: {
        donationId: createDonation._id.toString(),
      },
    });
  } catch (error) {
    if (!isReusedDonation) {
      await Donation.findByIdAndDelete(createDonation._id);
    }

    throw new AppError(
      error?.error?.description || "Payment gateway error",
      error?.statusCode || 500,
    );
  }

  try {
    const existingPendingPayment = await Payment.findOne({
      donation: createDonation._id,
      status: { $ne: "captured" },
    }).sort({ createdAt: -1 });

    if (existingPendingPayment) {
      existingPendingPayment.gatewayOrderId = order.id;
      existingPendingPayment.gatewayPaymentId = undefined;
      existingPendingPayment.gatewaySignature = undefined;
      existingPendingPayment.rawResponse = undefined;
      existingPendingPayment.amount = Number(amount);
      existingPendingPayment.currency = order.currency;
      existingPendingPayment.status = "created";
      await existingPendingPayment.save();
    } else {
      await Payment.create({
        donation: createDonation._id,
        gatewayOrderId: order.id,
        amount,
        currency: order.currency,
        status: "created",
      });
    }
  } catch (error) {
    if (!isReusedDonation) {
      await Donation.findByIdAndDelete(createDonation._id);
    }

    throw error;
  }

  return {
    status: 201,
    message: isReusedDonation
      ? "Donation retry order created successfully"
      : "Donation order created successfully",
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
    .limit(pageSize);
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

export const createOfflineDonationService = async (req) => {
  const user = req.user;
  const {
    campaignerId,
    donorName,
    donorPhone,
    donorEmail,
    amount,
    pan,
    paymentMode, // "cash" | "upi" | "cheque" | "bank_transfer"
    isAnonymous,
  } = req.body;

  // Required field validation
  if (!campaignerId) {
    throw new AppError("campaignerId is required", 400);
  }
  if (!mongoose.isValidObjectId(campaignerId)) {
    throw new AppError(`Invalid campaignerId: ${campaignerId}`, 400);
  }
  if (!donorName || !donorName.trim()) {
    throw new AppError("donorName is required", 400);
  }
  if (!donorPhone || !/^\d{10}$/.test(String(donorPhone).replace(/\D/g, "").slice(-10))) {
    throw new AppError("Valid 10-digit donorPhone is required", 400);
  }
  if (!amount || Number(amount) <= 0) {
    throw new AppError("Amount must be greater than 0", 400);
  }

  const allowedModes = ["cash", "upi", "cheque", "bank_transfer"];
  const mode = allowedModes.includes(paymentMode) ? paymentMode : "cash";

  // Fetch campaigner with owner info
  const campaigner = await Campaigner.findById(campaignerId).populate(
    "templeDevoteInTouch",
    "userId",
  );

  if (!campaigner) {
    throw new AppError("Campaigner not found", 404);
  }

  // Devotees can only add donations for their own campaigners
  if (user.role === "devotee") {
    const ownerId = campaigner.templeDevoteInTouch?.userId?.toString();
    if (!ownerId || ownerId !== user.id?.toString()) {
      throw new AppError(
        "You are not authorized to add donations for this campaigner",
        403,
      );
    }
  }

  // Create the donation directly as success
  const donation = await Donation.create({
    donorName: donorName.trim(),
    donorPhone: String(donorPhone).replace(/\D/g, "").slice(-10),
    donorEmail: donorEmail?.trim() || undefined,
    amount: Number(amount),
    campaign: campaigner.campaignId,
    campaigner: campaigner._id,
    status: "success",
    isAnonymous: Boolean(isAnonymous),
    pan: pan?.trim()?.toUpperCase() || undefined,
    paymentGateway: mode,
  });

  // Increment raised amounts
  await Campaigner.findByIdAndUpdate(campaigner._id, {
    $inc: { raisedAmount: donation.amount },
  });

  if (campaigner.campaignId) {
    await Campaign.findByIdAndUpdate(campaigner.campaignId, {
      $inc: { raisedAmount: donation.amount },
    });
  }

  // DCC payment mode codes — confirm with DCC team if these differ
  const DCC_PAYMENT_MODES = {
    cash: 1,
    cheque: 2,
    upi: 3,
    bank_transfer: 4,
  };

  // Sync with DCC and send WhatsApp receipt (same flow as online donations).
  // Failures here are logged but don't fail the donation entry itself.
  try {
    const donationForSync = await Donation.findById(donation._id)
      .populate("seva")
      .populate({
        path: "campaigner",
        select: "templeDevoteInTouch",
        populate: {
          path: "templeDevoteInTouch",
          select: "devoteeID",
        },
      });

    const campaignerForNotify = await Campaigner.findById(
      campaigner._id,
    ).populate("templeDevoteInTouch", "phoneNumber");

    if (donationForSync) {
      const syncedDonation = await syncDonationWithDcc(
        donationForSync,
        null,
        DCC_PAYMENT_MODES[mode] ?? 1,
      );

      await sendDonationNotifications(syncedDonation, campaignerForNotify);
    }
  } catch (error) {
    console.error(
      `Offline donation ${donation._id} saved but DCC sync / WhatsApp notification failed:`,
      error,
    );
  }

  return {
    status: 201,
    message: "Offline donation added successfully",
    data: donation,
  };
};
