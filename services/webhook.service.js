import crypto from "crypto";
import Payment from "../models/payment.model.js";
import Donation from "../models/donation.model.js";
import Campaigner from "../models/campaigner.model.js";
import Campaign from "../models/campaign.model.js";
import { generateReceiptNumber } from "../utils/utils.js";

export const razorpayWebhookService = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    const razorpaySignature = req.headers["x-razorpay-signature"];

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).send("Invalid signature");
    }

    const event = JSON.parse(req.body.toString());

    if (event.event === "payment.captured") {
      const payment = event.payload.payment.entity;
      const donationId = payment.notes.donationId;

      const paymentDoc = await Payment.findOne({
        gatewayOrderId: payment.order_id,
      });

      if (!paymentDoc) return res.json({ status: "payment_not_found" });

      if (paymentDoc.status === "captured") {
        return res.json({ status: "already_processed" });
      }

      paymentDoc.gatewayPaymentId = payment.id;
      paymentDoc.status = "captured";
      paymentDoc.rawResponse = payment;
      await paymentDoc.save();
      const receiptNumber = generateReceiptNumber();
      const updatedDonation = await Donation.findOneAndUpdate(
        { _id: donationId, status: { $ne: "success" } },
        { status: "success", receiptNumber, gatewayPaymentId: payment.id },
        { returnDocument: "after" },
      );

      if (updatedDonation) {
        if (updatedDonation.campaign) {
          await Campaign.findByIdAndUpdate(updatedDonation.campaign, {
            $inc: { raisedAmount: updatedDonation.amount },
          });
        }

        if (updatedDonation.campaigner) {
          await Campaigner.findByIdAndUpdate(updatedDonation.campaigner, {
            $inc: { raisedAmount: updatedDonation.amount },
          });
        }
      }
    }

    if (event.event === "payment.failed") {
      const payment = event.payload.payment.entity;
      const donationId = payment.notes.donationId;

      await Payment.findOneAndUpdate(
        { gatewayOrderId: payment.order_id },
        { status: "failed", rawResponse: payment },
      );

      await Donation.findOneAndUpdate(
        { _id: donationId, status: { $ne: "success" } },
        { status: "failed" },
      );
    }

    return res.json({ status: "ok" });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(200).json({ status: "error_logged" });
  }
};
