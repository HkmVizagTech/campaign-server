import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import FormData from "form-data";
import mongoose from "mongoose";
import path from "path";
import { connectToDB } from "../config/DBConnection.js";
import "../models/seva.model.js";
import "../models/campaign.model.js";
import "../models/campaigner.model.js";
import "../models/templeDevote.model.js";
import Donation from "../models/donation.model.js";
import { generateReceiptBuffer } from "../services/receipt.service.js";

dotenv.config();

const TEMPLATE_NAME = "common_donation_success_reciept";
const SEVA_NAME = "Mandir Nirman Seva";
const tmpDir = path.join(process.cwd(), "tmp");
const donationIdArg = process.argv[2];

const normalizePhoneNumber = (phoneNumber) => {
  const digits = phoneNumber?.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  return digits.startsWith("91") ? digits : `91${digits}`;
};

const sendUpdatedReceiptWhatsapp = async (
  phone,
  filePath,
  donorName,
  amount,
) => {
  const form = new FormData();
  const displayFilename = `Donation_Receipt_${(donorName || "Donor").replace(/\s+/g, "_")}.pdf`;

  form.append("token", process.env.FLAXXA_TOKEN);
  form.append("phone", phone);
  form.append("template_name", TEMPLATE_NAME);
  form.append("template_language", "en");
  form.append(
    "components",
    JSON.stringify([
      {
        type: "body",
        parameters: [
          { type: "text", text: donorName || "Donor" },
          {
            type: "text",
            text: Number(amount || 0).toLocaleString("en-IN"),
          },
          { type: "text", text: SEVA_NAME },
        ],
      },
    ]),
  );

  form.append("header_attachment", fs.createReadStream(filePath), {
    filename: displayFilename,
    contentType: "application/pdf",
  });

  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage_withattachment",
    form,
    {
      headers: form.getHeaders(),
    },
  );

  return response.data;
};

const resendUpdatedReceipts = async () => {
  if (donationIdArg && !mongoose.isValidObjectId(donationIdArg)) {
    throw new Error(`Invalid donation id: ${donationIdArg}`);
  }

  const query = {
    "dccApiResponse.success": true,
    status: "success",
  };

  if (donationIdArg) {
    query._id = donationIdArg;
  }

  const donations = await Donation.find(query).select(
    "_id donorName donorPhone amount receiptNumber dccApiResponse",
  );

  if (!donations.length) {
    if (donationIdArg) {
      console.log(
        `No successful DCC donation found for receipt resend with id ${donationIdArg}.`,
      );
      return;
    }

    console.log("No successful DCC donations found for receipt resend.");
    return;
  }

  fs.mkdirSync(tmpDir, { recursive: true });

  const summary = {
    total: donations.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  for (let index = 0; index < donations.length; index += 1) {
    const donation = donations[index];
    const donorId = donation._id.toString();
    const donorName = donation.donorName || "Donor";
    const phoneNumber = normalizePhoneNumber(donation.donorPhone);

    if (!phoneNumber) {
      summary.skipped += 1;
      console.log(
        `[${index + 1}/${donations.length}] Skipped donor ${donorName} (${donorId}) - invalid phone number`,
      );
      summary.failures.push({
        donationId: donorId,
        reason: "Missing or invalid donor phone number",
      });
      continue;
    }

    const safeDonorName = (donation.donorName || "Donor").replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );
    const filePath = path.join(
      tmpDir,
      `updated-receipt-${safeDonorName}-${donation._id}.pdf`,
    );

    try {
      console.log(
        `[${index + 1}/${donations.length}] Sending updated receipt to ${donorName} (${donorId}) on ${phoneNumber}`,
      );

      const pdfBytes = await generateReceiptBuffer(donation._id);
      fs.writeFileSync(filePath, pdfBytes);

      const response = await sendUpdatedReceiptWhatsapp(
        phoneNumber,
        filePath,
        donorName,
        donation.amount,
      );

      if (!response) {
        throw new Error("WhatsApp API did not confirm message delivery");
      }

      summary.sent += 1;
      console.log(
        `[${index + 1}/${donations.length}] WhatsApp success for ${donorName} (${donorId}). Sent count: ${summary.sent}`,
      );
      console.log("WhatsApp response:", response);
    } catch (error) {
      summary.failed += 1;
      console.error(
        `[${index + 1}/${donations.length}] WhatsApp failed for ${donorName} (${donorId}). Failed count: ${summary.failed}`,
      );
      console.error(
        "WhatsApp error:",
        error.response?.data || error.message || error,
      );
      summary.failures.push({
        donationId: donorId,
        reason: error.response?.data || error.message,
      });
    } finally {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
};

try {
  await connectToDB();
  await resendUpdatedReceipts();
} catch (error) {
  console.error("Receipt resend failed:", error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
