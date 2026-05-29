/**
 * Migration: Assign createdBy on orphaned campaigners
 *
 * Usage:
 *   node scripts/assignCampaignerOwnership.js <campaignerId> <devoteeId>
 *
 * Example:
 *   node scripts/assignCampaignerOwnership.js 6643abc123 6641xyz456
 *
 * To list all campaigners with no owner, run without args:
 *   node scripts/assignCampaignerOwnership.js
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectToDB } from "../config/DBConnection.js";
import "../models/campaign.model.js";
import Campaigner from "../models/campaigner.model.js";
import Register from "../models/register.model.js";

dotenv.config();

const campaignerId = process.argv[2];
const devoteeId = process.argv[3];

const run = async () => {
  await connectToDB();

  // List mode — no args provided
  if (!campaignerId && !devoteeId) {
    const orphaned = await Campaigner.find({ createdBy: null }).select(
      "_id name slug status",
    );

    if (orphaned.length === 0) {
      console.log("✅ No orphaned campaigners found. All have createdBy set.");
    } else {
      console.log(`⚠️  Found ${orphaned.length} campaigner(s) with no owner:\n`);
      orphaned.forEach((c) => {
        console.log(`  ID: ${c._id}  |  Name: ${c.name}  |  Slug: ${c.slug}  |  Status: ${c.status}`);
      });
      console.log(
        "\nTo assign ownership, run:\n  node scripts/assignCampaignerOwnership.js <campaignerId> <devoteeId>",
      );
    }

    await mongoose.disconnect();
    return;
  }

  // Assign mode
  if (!campaignerId || !devoteeId) {
    console.error("Usage: node scripts/assignCampaignerOwnership.js <campaignerId> <devoteeId>");
    process.exit(1);
  }

  if (!mongoose.isValidObjectId(campaignerId) || !mongoose.isValidObjectId(devoteeId)) {
    console.error("❌ Invalid ObjectId provided.");
    process.exit(1);
  }

  const campaigner = await Campaigner.findById(campaignerId);
  if (!campaigner) {
    console.error(`❌ Campaigner not found: ${campaignerId}`);
    process.exit(1);
  }

  const devotee = await Register.findById(devoteeId).select("name email role");
  if (!devotee) {
    console.error(`❌ Devotee not found: ${devoteeId}`);
    process.exit(1);
  }

  if (devotee.role !== "devotee" && devotee.role !== "admin") {
    console.error(`❌ User ${devoteeId} has role '${devotee.role}'. Expected devotee or admin.`);
    process.exit(1);
  }

  await Campaigner.findByIdAndUpdate(campaignerId, { createdBy: devoteeId });

  console.log(`✅ Assigned ownership:`);
  console.log(`   Campaigner : ${campaigner.name} (${campaignerId})`);
  console.log(`   Owner      : ${devotee.name} / ${devotee.email} (${devoteeId})`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
