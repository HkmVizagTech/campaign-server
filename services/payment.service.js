import crypto from "crypto";
import fs from "fs";
import path from "path";
import razorpay from "../config/razorpay.js";
import Payment from "../models/payment.model.js";
import Donation from "../models/donation.model.js";
import Campaigner from "../models/campaigner.model.js";
import Campaign from "../models/campaign.model.js";
import { dccApiService } from "../utils/utils.js";
import { AppError } from "../utils/AppError.js";
import { generateReceiptBuffer } from "./receipt.service.js";
import {
  sendRecieptWhatsapp,
  sendWhatsappMessage,
} from "./whatsapp.service.js";

const normalizePhoneNumber = (phoneNumber) => {
  const digits = phoneNumber?.replace(/\D/g, "");

  if (!digits) return null;

  return digits.startsWith("91") ? digits : `91${digits}`;
};

export const sendDonationNotifications = async (updatedDonation, campaigner) => {
  if (!updatedDonation?.receiptNumber) {
    const phoneNumber = normalizePhoneNumber(updatedDonation?.donorPhone);

    if (phoneNumber) {
      await sendWhatsappMessage(
        phoneNumber,
        "regular_donation_success_message",
        [
          { type: "text", text: updatedDonation.donorName || "Donor" },
          {
            type: "text",
            text: Number(updatedDonation.amount || 0).toLocaleString("en-IN"),
          },
          {
            type: "text",
            text: "Mandir Nirmana Seva",
          },
          {
            type: "text",
            text: "Mandir Nirmana Seva",
          },
        ],
      );
    }

    return;
  }

  const tmpDir = path.join(process.cwd(), "tmp");

  fs.mkdirSync(tmpDir, { recursive: true });

  const filePath = path.join(
    tmpDir,
    `receipt-${updatedDonation.donorName}-${updatedDonation._id}.pdf`,
  );
  const pdfBytes = await generateReceiptBuffer(updatedDonation._id);
  fs.writeFileSync(filePath, pdfBytes);

  const phoneNumber = normalizePhoneNumber(updatedDonation.donorPhone);
  const devoteePhoneNumber = normalizePhoneNumber(
    campaigner?.templeDevoteInTouch?.phoneNumber,
  );
  const campaignerPhoneNumber = normalizePhoneNumber(campaigner?.phoneNumber);

  try {
    const promises = [];

    if (phoneNumber) {
      promises.push(
        sendRecieptWhatsapp(
          phoneNumber,
          filePath,
          updatedDonation.donorName,
          updatedDonation.amount,
        ),
      );
    }

    if (campaigner?.name) {
      const params = [
        { type: "text", text: campaigner.name },
        { type: "text", text: updatedDonation.donorName },
        {
          type: "text",
          text: Number(updatedDonation.amount || 0).toLocaleString("en-IN"),
        },
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
    }

    await Promise.all(promises);
  } finally {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
};

export const syncDonationWithDcc = async (
  donation,
  gatewayPaymentId,
  modeOfPayment = 3,
) => {
  const dccResponse = await dccApiService(
    donation,
    gatewayPaymentId,
    modeOfPayment,
  );

  donation.dccApiResponse = dccResponse;
  donation.gatewayPaymentId = donation.gatewayPaymentId || gatewayPaymentId;

  if (dccResponse?.success) {
    donation.receiptNumber =
      donation.receiptNumber || dccResponse?.data?.ReceiptNumber || null;
    donation.dccDataSentAt = donation.dccDataSentAt || new Date();
  }

  await donation.save();

  return donation;
};

export const capturePaymentService = async ({
  gatewayOrderId,
  gatewayPaymentId,
  gatewaySignature,
  rawResponse,
  donationId,
  // Only ever set by the webhook handler, using the status straight from
  // Razorpay's own HMAC-signed payload — that signature already proves
  // authenticity, so no extra live API call is needed or made in that case.
  // /payment/verify and the admin reconcile tool never set this, since a
  // caller-supplied payment ID there has no such cryptographic guarantee
  // and MUST be re-confirmed live against Razorpay.
  trustedPaymentStatus,
}) => {
  // Absolute guard, enforced at the single choke point every caller
  // (webhook, /payment/verify, and the admin reconcile tool) goes
  // through: a Razorpay payment ID always starts with "pay_". An
  // order ID (starts with "order_") must NEVER be accepted here —
  // this exact mix-up is what let failed transactions get recorded
  // as successful, with receipts created and WhatsApp sent for
  // payments that never actually succeeded.
  if (!/^pay_[A-Za-z0-9]+$/.test(String(gatewayPaymentId || "").trim())) {
    throw new AppError(
      `"${gatewayPaymentId}" is not a valid Razorpay payment ID (must start with "pay_"). Refusing to capture — an order ID must never be used here.`,
      400,
    );
  }

  const paymentDoc = await Payment.findOne({
    gatewayOrderId,
  });

  if (!paymentDoc) {
    if (donationId) {
      console.error(
        `Payment record not found for orderId: ${gatewayOrderId}, donationId: ${donationId}. Use the reconcile script to fix this.`,
      );
    } else {
      console.error(
        `Payment record not found for orderId: ${gatewayOrderId}. This payment is not linked to any donation.`,
      );
    }
    throw new AppError("Payment record not found", 404);
  }

  const linkedDonationId = paymentDoc.donation?.toString() || donationId;

  const existingDonation = await Donation.findById(linkedDonationId)
    .populate("seva")
    .populate({
      path: "campaigner",
      select: "templeDevoteInTouch",
      populate: {
        path: "templeDevoteInTouch",
        select: "devoteeID",
      },
    });

  if (!existingDonation) {
    throw new AppError("Donation record not found", 404);
  }

  if (
    paymentDoc.status === "captured" &&
    existingDonation.status === "success"
  ) {
    if (
      !paymentDoc.rawResponse &&
      rawResponse &&
      typeof rawResponse === "object" &&
      Object.keys(rawResponse).length > 0
    ) {
      paymentDoc.rawResponse = rawResponse;
      await paymentDoc.save();
    }

    if (!existingDonation.dccDataSentAt) {
      await syncDonationWithDcc(existingDonation, gatewayPaymentId);
    }

    return {
      status: 200,
      message: "Payment already processed",
    };
  }

  // CRITICAL: never trust a signature match or a caller-supplied payload
  // as proof of a successful payment. Always re-confirm the payment's
  // actual current status directly from Razorpay before marking a
  // donation as success — this is the only source of truth.
  //
  // EXCEPTION: the webhook payload itself is HMAC-signed by Razorpay
  // (verified before this function is ever called), so its embedded
  // payment status is already authentic — no live API call needed
  // there, which also avoids a live-fetch outage/rate-limit taking
  // down webhook processing and causing Razorpay to auto-disable it
  // after repeated failures.
  let liveRazorpayPayment;

  if (trustedPaymentStatus) {
    liveRazorpayPayment = {
      status: trustedPaymentStatus,
      order_id: gatewayOrderId,
    };
  } else {
    try {
      liveRazorpayPayment = await razorpay.payments.fetch(gatewayPaymentId);
    } catch (error) {
      const statusCode = error?.statusCode || error?.status;
      const razorpayCode = error?.error?.code;
      const isGenuineNotFound =
        (statusCode === 400 || statusCode === 404) &&
        (razorpayCode === "BAD_REQUEST_ERROR" ||
          error?.error?.description?.toLowerCase().includes("does not exist"));

      console.error(
        `Failed to fetch payment ${gatewayPaymentId} from Razorpay:`,
        error?.error?.description || error.message,
      );

      if (isGenuineNotFound) {
        throw new AppError(
          `Payment ${gatewayPaymentId} does not exist on Razorpay.`,
          400,
        );
      }

      // Transient failure (network, rate limit, auth) — refuse to proceed
      // but make clear this isn't a "doesn't exist" situation, so callers
      // (reconcile) know it's safe/worth retrying.
      throw new AppError(
        `Could not verify payment ${gatewayPaymentId} with Razorpay right now — try again shortly.`,
        503,
      );
    }
  }

  if (
    liveRazorpayPayment.status !== "captured" &&
    liveRazorpayPayment.status !== "authorized"
  ) {
    // Payment genuinely did not succeed — mark it failed and stop here.
    // No WhatsApp, no DCC call, no raisedAmount update happens below this line.
    paymentDoc.status = "failed";
    paymentDoc.rawResponse = liveRazorpayPayment;
    await paymentDoc.save();

    await Donation.findByIdAndUpdate(linkedDonationId, { status: "failed" });

    throw new AppError(
      `Razorpay reports this payment as '${liveRazorpayPayment.status}', not captured. Donation marked as failed — no receipt or notification sent.`,
      400,
    );
  }

  if (liveRazorpayPayment.order_id !== gatewayOrderId) {
    throw new AppError(
      `Payment ${gatewayPaymentId} belongs to a different order (${liveRazorpayPayment.order_id}), not ${gatewayOrderId}. Refusing to capture.`,
      400,
    );
  }

  paymentDoc.gatewayPaymentId = gatewayPaymentId;
  paymentDoc.status = "captured";

  if (gatewaySignature) {
    paymentDoc.gatewaySignature = gatewaySignature;
  }

  if (rawResponse) {
    paymentDoc.rawResponse = rawResponse;
  }

  await paymentDoc.save();

  const updatedDonation = await Donation.findOneAndUpdate(
    {
      _id: linkedDonationId,
      status: { $ne: "success" },
    },
    {
      status: "success",
      gatewayPaymentId,
    },
    { returnDocument: "after" },
  );

  let updatedCampaigner = null;

  if (updatedDonation) {
    if (updatedDonation.campaign) {
      await Campaign.findByIdAndUpdate(updatedDonation.campaign, {
        $inc: { raisedAmount: updatedDonation.amount },
      });
    }

    if (updatedDonation.campaigner) {
      updatedCampaigner = await Campaigner.findByIdAndUpdate(
        updatedDonation.campaigner,
        {
          $inc: { raisedAmount: updatedDonation.amount },
        },
        {
          returnDocument: "after",
        },
      ).populate("templeDevoteInTouch", "phoneNumber");
    }
    try {
      const donationForSync = await Donation.findById(updatedDonation._id)
        .populate("seva")
        .populate({
          path: "campaigner",
          select: "templeDevoteInTouch",
          populate: {
            path: "templeDevoteInTouch",
            select: "devoteeID",
          },
        });

      if (donationForSync) {
        const syncedDonation = await syncDonationWithDcc(
          donationForSync,
          gatewayPaymentId,
        );

        await sendDonationNotifications(syncedDonation, updatedCampaigner);
      }
    } catch (error) {
      console.error(
        "Payment captured but post-capture sync failed:",
        error,
      );
    }
  }

  return {
    status: 200,
    message: updatedDonation
      ? "Payment verified successfully"
      : "Payment already processed",
  };
};

export const verifyPaymentService = async (req) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new AppError("Missing payment verification fields", 400);
  }

  if (!process.env.RAZORPAY_KEY_SECRET) {
    throw new AppError("Razorpay key secret not configured", 500);
  }

  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (generatedSignature !== razorpay_signature) {
    throw new AppError("Invalid Razorpay signature", 400);
  }

  return capturePaymentService({
    gatewayOrderId: razorpay_order_id,
    gatewayPaymentId: razorpay_payment_id,
    gatewaySignature: razorpay_signature,
  });
};
