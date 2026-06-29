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

const dashboardRouter = express.Router();

dashboardRouter.get("/summary", verifyToken, authorizeRole("admin", "devotee"), cardSummary);
dashboardRouter.get("/donation-trend", verifyToken, authorizeRole("admin", "devotee"), donationTrend);
dashboardRouter.get("/reports/devotee-summary", verifyToken, authorizeRole("admin", "superAdmin"), devoteeReport);
dashboardRouter.get("/reports/prasadam", verifyToken, authorizeRole("admin", "superAdmin"), prasadamReport);

// TEMPORARY — remove after reconcile is done
dashboardRouter.post(
  "/reconcile-donation",
  verifyToken,
  authorizeRole("admin"),
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
