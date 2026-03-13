import crypto from "crypto";
import Payment from "../models/payment.model.js";
import Donation from "../models/donation.model.js";
import Campaigner from "../models/campaigner.model.js";
import Campaign from "../models/campaign.model.js";
import { generateReceiptNumber } from "../utils/utils.js";
import fs from "fs";
import path from "path";
import { generateReceiptBuffer } from "./receipt.service.js";
import {
  sendRecieptWhatsapp,
  sendWhatsappMessage,
} from "./whatsapp.service.js";

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
        let campaigner;
        if (updatedDonation.campaigner) {
          campaigner = await Campaigner.findByIdAndUpdate(
            updatedDonation.campaigner,
            {
              $inc: { raisedAmount: updatedDonation.amount },
            },
            {
              returnDocument: "after",
            },
          ).populate("templeDevoteInTouch", "phoneNumber");
        }

        const tmpDir = path.join(process.cwd(), "tmp");

        fs.mkdirSync(tmpDir, { recursive: true });

        const filePath = path.join(
          tmpDir,
          `receipt-${updatedDonation._id}.pdf`,
        );
        const pdfBytes = await generateReceiptBuffer(updatedDonation._id);
        fs.writeFileSync(filePath, pdfBytes);
        const phoneNumber = updatedDonation.donorPhone
          .replace(/\D/g, "")
          .startsWith("91")
          ? updatedDonation.donorPhone.replace(/\D/g, "")
          : `91${updatedDonation.donorPhone.replace(/\D/g, "")}`;

        const devoteePhoneNumber = campaigner?.templeDevoteInTouch?.phoneNumber
          ?.replace(/\D/g, "")
          ?.startsWith("91")
          ? campaigner.templeDevoteInTouch.phoneNumber.replace(/\D/g, "")
          : `91${campaigner?.templeDevoteInTouch?.phoneNumber?.replace(/\D/g, "")}`;

        const campaignerPhoneNumber = campaigner.phoneNumber
          ?.replace(/\D/g, "")
          ?.startsWith("91")
          ? campaigner.phoneNumber?.replace(/\D/g, "")
          : `91${campaigner.phoneNumber?.replace(/\D/g, "")}`;

        try {
          const params = [
            { type: "text", text: campaigner.name },
            { type: "text", text: updatedDonation?.donorName },
            { type: "text", text: String(updatedDonation?.amount) },
          ];

          const promises = [
            sendRecieptWhatsapp(
              phoneNumber,
              filePath,
              updatedDonation.donorName,
              updatedDonation.amount,
            ),
          ];

          if (campaignerPhoneNumber) {
            promises.push(
              sendWhatsappMessage(
                campaignerPhoneNumber,
                "campaigner_donation_notification",
                params,
              ),
            );
          }

          if (devoteePhoneNumber) {
            promises.push(
              sendWhatsappMessage(
                devoteePhoneNumber,
                "preacher_group_alert",
                params,
              ),
            );
          }

          await Promise.all(promises);
        } finally {
          try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch (err) {
            console.error("Failed to delete temp receipt:", err);
          }
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
