import axios from "axios";
import { AppError } from "./AppError.js";

// Used whenever a donor does not give an email address, so DCC and the
// receipt always have one.
export const DEFAULT_DONOR_EMAIL =
  process.env.DEFAULT_DONOR_EMAIL?.trim() || "donor@hkmvizag.org";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const resolveDonorEmail = (email) => {
  const trimmed = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!trimmed) return DEFAULT_DONOR_EMAIL;

  if (!EMAIL_PATTERN.test(trimmed)) {
    throw new AppError("Please enter a valid email address", 400);
  }

  return trimmed;
};

const HONOREE_MAX_LENGTH = 100;

// "In honour of" dedication. Returns undefined when not provided.
export const parseInHonorOf = (inHonorOf) => {
  if (inHonorOf == null || inHonorOf === "") return undefined;

  if (typeof inHonorOf !== "object" || Array.isArray(inHonorOf)) {
    throw new AppError("inHonorOf must be an object with a name", 400);
  }

  const name = typeof inHonorOf.name === "string" ? inHonorOf.name.trim() : "";
  const occasion =
    typeof inHonorOf.occasion === "string" ? inHonorOf.occasion.trim() : "";

  if (!name && !occasion) return undefined;

  if (!name) {
    throw new AppError("Name of the person being honoured is required", 400);
  }

  if (name.length > HONOREE_MAX_LENGTH || occasion.length > HONOREE_MAX_LENGTH) {
    throw new AppError(
      `In honour of name and occasion must be at most ${HONOREE_MAX_LENGTH} characters`,
      400,
    );
  }

  return occasion ? { name, occasion } : { name };
};

export const formatInHonorOf = (inHonorOf) => {
  if (!inHonorOf?.name) return "";
  return inHonorOf.occasion
    ? `${inHonorOf.name} (${inHonorOf.occasion})`
    : inHonorOf.name;
};

export const normalizePhoneNumber = (phoneNumber) => {
  const digits = phoneNumber?.replace(/\D/g, "");

  if (!digits) return null;

  return digits.startsWith("91") ? digits : `91${digits}`;
};

export const dccApiService = async (
  donation,
  gatewayPaymentId = null,
  modeOfPayment = 3,
) => {
  if (!donation) {
    return {
      success: false,
      data: null,
      error: { message: "Donation payload is required" },
    };
  }

  const payload = {
    donorName: donation.donorName,
    donorPhone: donation.donorPhone,
    donorEmail: donation?.donorEmail || DEFAULT_DONOR_EMAIL,
    gender: null,
    address: {
      fullAddress: donation?.address?.fullAddress || null,
      state: donation?.address?.state || null,
      city: donation?.address?.city || null,
      pinCode: donation?.address?.pincode || null,
    },
    PAN: donation?.pan || null,
    amount: String(donation?.amount || 0),
    accountType: 4,
    // Default seva mapping for campaigner donations (no seva explicitly selected):
    // Category "Online Donation" (24) -> Mandir Nirman Seva OL (119), per DCC mapping table.
    sevaCategory: donation?.seva?.sevaCategoryId || 24,
    sevaSubCategory: donation?.seva?.sevaSubCategoryId || 119,
    sevaSubCategoryCode: donation?.seva?.sevaSubCode || null,
    modeOfPayment,
    // Online: Razorpay payment id. Manually recorded UPI donations: the UPI
    // transaction reference (UTR) entered by the admin/devotee.
    gatewayPaymentId:
      gatewayPaymentId ||
      donation?.gatewayPaymentId ||
      donation?.paymentReference ||
      null,
    // Manually recorded UPI donations carry the real transaction date
    // (stored as a calendar date at 00:00 UTC); everything else uses the
    // time the donation was created.
    transactionDate: donation.paymentDate
      ? donation.paymentDate.toLocaleDateString("en-GB", { timeZone: "UTC" })
      : donation.createdAt.toLocaleDateString("en-GB"),
    enrolledBy: donation?.campaigner?.templeDevoteInTouch?.devoteeID || null,
  };

  try {
    const headers = {
      "DCC-Api-Key": process.env.DCC_API_KEY,
      "Content-Type": "application/json",
    };

    const result = await axios.post(process.env.DCC_API, payload, {
      headers,
      timeout: 20000,
    });

    return {
      success: true,
      data: result?.data || null,
      error: null,
      payloadSent: payload,
    };
  } catch (error) {
    const errorPayload = error.response?.data || { message: error.message };
    console.log("DCC api failed: ", errorPayload);

    return {
      success: false,
      data: null,
      error: errorPayload,
      payloadSent: payload,
    };
  }
};
