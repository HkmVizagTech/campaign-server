import cron from "node-cron";
import Donation from "../models/donation.model.js";
import Payment from "../models/payment.model.js";

// A checkout session (Razorpay order) is realistically only valid for a
// short window. If a donation is still "pending" after this long, the
// donor almost certainly abandoned checkout without attempting payment —
// which means Razorpay never sends any webhook event for it at all.
// Without this job those donations would stay "pending" forever and
// never show up as accounted for in any report.
const STALE_PENDING_MINUTES = 45;

export const expireStalePendingDonations = async () => {
  const cutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60 * 1000);

  const result = await Donation.updateMany(
    { status: "pending", createdAt: { $lte: cutoff } },
    { status: "failed" },
  );

  // Payment records track the Razorpay order status separately.
  // No sendDonationNotifications / dccApiService call happens here —
  // this job only ever updates status fields.
  await Payment.updateMany(
    { status: "created", createdAt: { $lte: cutoff } },
    { status: "failed" },
  );

  if (result.modifiedCount > 0) {
    console.log(
      `[stale-donation-cleanup] Marked ${result.modifiedCount} stale pending donation(s) as failed (older than ${STALE_PENDING_MINUTES}m). No notifications sent.`,
    );
  }
};

// Runs every 15 minutes. No WhatsApp / DCC call is ever made here —
// this only updates status so every donation is accounted for
// (success or failed), never silently stuck as pending.
export const startStaleDonationCleanupJob = () => {
  cron.schedule("*/15 * * * *", () => {
    expireStalePendingDonations().catch((error) => {
      console.error("[stale-donation-cleanup] Job failed:", error);
    });
  });

  console.log(
    `[stale-donation-cleanup] Scheduled — checks every 15 minutes for donations pending longer than ${STALE_PENDING_MINUTES} minutes.`,
  );
};
