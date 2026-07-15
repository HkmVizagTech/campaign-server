import express from "express";
import {
  cardSummary,
  devoteeReport,
  donationTrend,
  prasadamReport,
} from "../controllers/dashboard.controller.js";
import { verifyToken } from "../middlewares/verifyToken.middleware.js";
import { authorizeRole } from "../middlewares/onlyAdmin.middleware.js";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";
import { capturePaymentService } from "../services/payment.service.js";
import Donation from "../models/donation.model.js";
import Payment from "../models/payment.model.js";
import mongoose from "mongoose";

import razorpay from "../config/razorpay.js";

const dashboardRouter = express.Router();

dashboardRouter.get("/summary", verifyToken, authorizeRole("admin", "devotee"), cardSummary);
dashboardRouter.get("/donation-trend", verifyToken, authorizeRole("admin", "devotee"), donationTrend);
dashboardRouter.get("/reports/devotee-summary", verifyToken, authorizeRole("admin", "superAdmin"), devoteeReport);
dashboardRouter.get("/reports/prasadam", verifyToken, authorizeRole("admin", "superAdmin"), prasadamReport);

dashboardRouter.get(
  "/audit-donations",
  verifyToken,
  authorizeRole("admin", "superAdmin"),
  asyncHandlers(async (req, res) => {
    const { fromDate, toDate, limit = 200 } = req.query;

    const filter = { status: "success", gatewayPaymentId: { $exists: true, $ne: null } };
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }

    const donations = await Donation.find(filter)
      .select("donorName donorPhone amount gatewayPaymentId createdAt campaigner receiptNumber")
      .populate("campaigner", "name")
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    const mismatches = [];
    let checked = 0;

    for (const donation of donations) {
      try {
        const livePayment = await razorpay.payments.fetch(donation.gatewayPaymentId);
        checked++;
        if (livePayment.status !== "captured" && livePayment.status !== "authorized") {
          mismatches.push({
            donationId: donation._id,
            donorName: donation.donorName,
            amount: donation.amount,
            campaigner: donation.campaigner?.name,
            receiptNumber: donation.receiptNumber,
            gatewayPaymentId: donation.gatewayPaymentId,
            razorpayStatus: livePayment.status,
            createdAt: donation.createdAt,
          });
        }
      } catch (err) {
        mismatches.push({
          donationId: donation._id,
          donorName: donation.donorName,
          amount: donation.amount,
          campaigner: donation.campaigner?.name,
          receiptNumber: donation.receiptNumber,
          gatewayPaymentId: donation.gatewayPaymentId,
          razorpayStatus: "NOT_FOUND_ON_RAZORPAY",
          createdAt: donation.createdAt,
        });
      }
    }

    response(res, 200, "Audit complete", {
      totalChecked: checked,
      totalMismatches: mismatches.length,
      mismatches,
    });
  }),
);

dashboardRouter.get(
  "/pending-donations",
  verifyToken,
  authorizeRole("admin", "superAdmin"),
  asyncHandlers(async (req, res) => {
    const unresolved = await Donation.find({
      status: { $in: ["pending", "failed"] },
    })
      .populate("campaigner", "name slug")
      .sort({ createdAt: -1 })
      .limit(100)
      .select("donorName donorPhone amount status createdAt campaigner");

    response(res, 200, "Pending/failed donations fetched", unresolved);
  }),
);

dashboardRouter.get(
  "/donation-lookup/:donationId",
  verifyToken,
  authorizeRole("admin", "superAdmin"),
  asyncHandlers(async (req, res) => {
    const { donationId } = req.params;

    if (!mongoose.isValidObjectId(donationId)) {
      return response(res, 400, "Invalid donationId");
    }

    const donation = await Donation.findById(donationId)
      .populate("campaigner", "name slug")
      .select(
        "donorName donorPhone donorEmail amount status createdAt campaigner receiptNumber gatewayPaymentId",
      );

    if (!donation) {
      return response(res, 404, "Donation not found");
    }

    const paymentDoc = await Payment.findOne({
      donation: donation._id,
    }).select("gatewayOrderId status");

    response(res, 200, "Donation found", { donation, payment: paymentDoc });
  }),
);

dashboardRouter.post(
  "/reconcile-donation",
  verifyToken,
  authorizeRole("admin", "superAdmin"),
  asyncHandlers(async (req, res) => {
    const { donationId, paymentId } = req.body;

    if (!donationId || !paymentId) {
      return response(res, 400, "donationId and paymentId are required");
    }
    if (!mongoose.isValidObjectId(donationId)) {
      return response(res, 400, "Invalid donationId");
    }

    const donation = await Donation.findById(donationId);
    if (!donation) {
      return response(res, 404, "Donation not found");
    }
    if (donation.status === "success") {
      return response(res, 200, "Donation already captured", { status: donation.status });
    }

    const paymentDoc = await Payment.findOne({ donation: donation._id });
    if (!paymentDoc?.gatewayOrderId) {
      return response(res, 404, "Payment record not found for this donation");
    }

    const result = await capturePaymentService({
      gatewayOrderId: paymentDoc.gatewayOrderId,
      gatewayPaymentId: paymentId,
      rawResponse: { id: paymentId, order_id: paymentDoc.gatewayOrderId },
      donationId: donation._id.toString(),
    });

    const updated = await Donation.findById(donationId).select(
      "status receiptNumber dccDataSentAt amount donorName",
    );

    response(res, 200, result.message, updated);
  }),
);

export default dashboardRouter;
