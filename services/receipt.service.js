import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import Donation from "../models/donation.model.js";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import path from "path";
import { DEFAULT_DONOR_EMAIL, formatInHonorOf } from "../utils/utils.js";

const resolveFontPath = (fontPath) => {
  if (!fontPath) {
    return null;
  }

  return path.isAbsolute(fontPath)
    ? fontPath
    : path.resolve(process.cwd(), fontPath);
};

const DEFAULT_RECEIPT_FONT_PATHS = [
  resolveFontPath(process.env.RECEIPT_FONT_PATH),
  path.resolve(process.cwd(), "assets/fonts/NotoSansTelugu-Regular.ttf"),
  "/Library/Fonts/Arial Unicode.ttf",
  "/usr/share/fonts/truetype/noto/NotoSansTelugu-Regular.ttf",
  "/usr/share/fonts/opentype/noto/NotoSansTelugu-Regular.ttf",
].filter(Boolean);

const sanitizePdfText = (value, fieldName) => {
  const text = value == null ? "" : String(value);
  const sanitized = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");

  if (sanitized !== text) {
    console.warn(
      `PDF text sanitized for ${fieldName}. Original contained unsupported characters.`,
    );
  }

  return sanitized;
};

// Unicode font for text Helvetica cannot encode (e.g. names in Telugu).
const loadUnicodeFont = async (pdfDoc) => {
  pdfDoc.registerFontkit(fontkit);

  for (const fontPath of DEFAULT_RECEIPT_FONT_PATHS) {
    if (!fs.existsSync(fontPath)) {
      continue;
    }

    if (path.extname(fontPath).toLowerCase() === ".ttc") {
      console.warn(
        `Skipping receipt font collection ${fontPath}. Use a .ttf or .otf font file instead.`,
      );
      continue;
    }

    try {
      // Subset: the full font is ~23 MB and would otherwise be copied into
      // every receipt.
      return await pdfDoc.embedFont(fs.readFileSync(fontPath), { subset: true });
    } catch (error) {
      console.warn(
        `Failed to embed receipt font at ${fontPath}: ${error.message}`,
      );
    }
  }

  return null;
};

const RECEIPT_ASSETS_DIR = path.resolve(process.cwd(), "assets/receipt");
const LOGO_BYTES = fs.readFileSync(path.join(RECEIPT_ASSETS_DIR, "hkm-logo.jpg"));
const SEAL_BYTES = fs.readFileSync(path.join(RECEIPT_ASSETS_DIR, "hkmi-seal.png"));

const GREY = rgb(128 / 255, 128 / 255, 128 / 255);
const RIGHT_EDGE = 570;

const ONES = [
  "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
  "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
  "SEVENTEEN", "EIGHTEEN", "NINETEEN",
];
const TENS = [
  "", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY",
  "NINETY",
];

const belowHundred = (n) =>
  n < 20 ? ONES[n] : [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");

const belowThousand = (n) =>
  [
    n >= 100 ? `${ONES[Math.floor(n / 100)]} HUNDRED` : "",
    belowHundred(n % 100),
  ]
    .filter(Boolean)
    .join(" ");

// Indian numbering, as on DCC receipts: 312500 -> "THREE LAKH TWELVE THOUSAND FIVE HUNDRED ONLY".
export const amountInWords = (amount) => {
  let n = Math.floor(Number(amount) || 0);
  if (n === 0) return "ZERO ONLY";

  const parts = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;

  if (crore) parts.push(`${crore >= 1000 ? amountInWords(crore).replace(/ ONLY$/, "") : belowThousand(crore)} CRORE`);
  if (lakh) parts.push(`${belowHundred(lakh)} LAKH`);
  if (thousand) parts.push(`${belowHundred(thousand)} THOUSAND`);
  if (n) parts.push(belowThousand(n));

  return `${parts.join(" ")} ONLY`;
};

const formatDate = (date, timeZone = "Asia/Kolkata") =>
  date
    ? new Date(date).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone,
      })
    : "";

const PAYMENT_MODE_LABELS = {
  razorpay: "Online",
  cash: "Cash",
  upi: "UPI",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
};

// "Reference(Patronship No)" is the DCC donor id (e.g. D50574). DCC's
// response field name isn't documented, so match the likely spellings
// regardless of case, including one level of nesting.
const DONOR_ID_KEYS = new Set([
  "donorid",
  "donorcode",
  "donorno",
  "donornumber",
  "patronshipno",
  "patronshipnumber",
  "patronid",
  "patronno",
]);

const getDonorId = (dccData, depth = 0) => {
  if (!dccData || typeof dccData !== "object" || depth > 1) return "";

  for (const [key, value] of Object.entries(dccData)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (DONOR_ID_KEYS.has(normalized) && value != null && value !== "") {
      return String(value);
    }
  }

  for (const value of Object.values(dccData)) {
    const nested = getDonorId(value, depth + 1);
    if (nested) return nested;
  }

  return "";
};

const formatAddress = (address) => {
  if (!address) return "";
  const street = [address.fullAddress, address.city, address.state]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
  const pincode = address.pincode?.trim();
  return [street, pincode].filter(Boolean).join(" - ");
};

const canEncode = (font, text) => {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
};

const createWriter = (page, fonts) => {
  // Helvetica matches the DCC receipt; fall back to the Unicode font (or
  // sanitized text) for characters outside WinAnsi.
  const resolve = (text, bold) => {
    const value = text == null ? "" : String(text);
    const base = bold ? fonts.bold : fonts.regular;
    if (canEncode(base, value)) return { value, font: base };
    if (fonts.unicode && canEncode(fonts.unicode, value)) {
      return { value, font: fonts.unicode };
    }
    return { value: sanitizePdfText(value, "receipt"), font: base };
  };

  // drawText does not apply kerning but widthOfTextAtSize does, so measure
  // glyph by glyph to keep segments and right-aligned text where they belong.
  const widthOf = (value, font, size) =>
    [...value].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size), 0);

  const measure = (segments, size) =>
    segments.reduce((width, { text, bold }) => {
      const { value, font } = resolve(text, bold);
      return width + widthOf(value, font, size);
    }, 0);

  const draw = (x, y, segments, { size = 10, color = rgb(0, 0, 0) } = {}) => {
    let cursor = x;
    for (const { text, bold } of segments) {
      const { value, font } = resolve(text, bold);
      if (!value) continue;
      page.drawText(value, { x: cursor, y, size, font, color });
      cursor += widthOf(value, font, size);
    }
  };

  const drawRight = (right, y, segments, options = {}) =>
    draw(right - measure(segments, options.size ?? 10), y, segments, options);

  // Shrink a value until it fits the space left on its line.
  const fitSize = (segments, maxWidth, size = 10, min = 6) => {
    let fitted = size;
    while (fitted > min && measure(segments, fitted) > maxWidth) fitted -= 0.5;
    return fitted;
  };

  return { draw, drawRight, fitSize };
};

const plain = (text) => ({ text, bold: false });
const bold = (text) => ({ text, bold: true });

// Lays out the receipt the way DCC prints it (A4, Helvetica, same positions).
export const generateReceiptBuffer = async (donationId) => {
  const donationDetails = await Donation.findById(donationId)
    .populate("seva")
    .populate({
      path: "campaigner",
      select: "templeDevoteInTouch",
      populate: {
        path: "templeDevoteInTouch",
        select: "shortForm",
      },
    });

  if (!donationDetails) {
    throw new AppError("Donation not found", 404);
  }

  const dccData = donationDetails?.dccApiResponse?.data;
  const receiptNumber =
    dccData?.ReceiptNumber || donationDetails.receiptNumber || "";
  const receiptDate = formatDate(donationDetails.createdAt);
  // Manually recorded UPI donations store the real transaction date as a
  // calendar date at 00:00 UTC.
  const transactionDate = donationDetails.paymentDate
    ? formatDate(donationDetails.paymentDate, "UTC")
    : receiptDate;
  const shortForm =
    donationDetails?.campaigner?.templeDevoteInTouch?.shortForm || "";
  const towards =
    donationDetails?.seva?.sevaSubCategory || "Mandir Nirman Seva";
  const email = donationDetails?.donorEmail || DEFAULT_DONOR_EMAIL;
  const paymentMode =
    PAYMENT_MODE_LABELS[donationDetails.paymentGateway] || "Online";
  const reference =
    donationDetails.gatewayPaymentId || donationDetails.paymentReference || "";
  const sevakName = formatInHonorOf(donationDetails?.inHonorOf);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fonts = {
    regular,
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    unicode: null,
  };
  const needsUnicode = [
    donationDetails.donorName,
    formatAddress(donationDetails.address),
    email,
    sevakName,
    towards,
  ].some((text) => text && !canEncode(regular, text));
  if (needsUnicode) {
    fonts.unicode = await loadUnicodeFont(pdfDoc);
  }
  const { draw, drawRight, fitSize } = createWriter(page, fonts);

  // Header
  draw(418.34, 756.03, [bold("DONATION")], { size: 16, color: GREY });
  draw(390.32, 732.03, [bold("Acknowledgement")], { size: 16, color: GREY });
  page.drawImage(await pdfDoc.embedJpg(LOGO_BYTES), {
    x: 25,
    y: 602.63,
    width: 107.75,
    height: 65,
  });
  drawRight(RIGHT_EDGE, 667.75, [bold("HARE KRISHNA MOVEMENT INDIA")], { size: 16 });
  [
    [652.44, "(Serving the Mission of His Divine Grace A.C. Bhaktivendanta swami Prabhupada)"],
    [638.78, "Branch Office : #8-22, Near RTO Office, Next to Akshaya Patra Foundation Kitchen,"],
    [625.13, "IIM Road, Gambheeram, Visakhapatanam - 530052. (A.P.) INDIA."],
    [611.47, "Phone : +91 9030696108, E-mail : donorcare@hkmvizag.org"],
    [597.82, "HKMI PAN No : AABTH4550P"],
  ].forEach(([y, text]) => drawRight(RIGHT_EDGE, y, [plain(text)], { size: 8 }));

  // Title, receipt number and date
  draw(232.66, 560.5, [bold("DONATION RECEIPT")], { size: 12 });
  page.drawLine({
    start: { x: 232.66, y: 556.5 },
    end: { x: 352, y: 556.5 },
    thickness: 0.8,
  });
  drawRight(RIGHT_EDGE, 561.09, [plain("DR No. "), bold(receiptNumber)]);
  drawRight(RIGHT_EDGE, 544.02, [plain("Date: "), bold(receiptDate)]);

  // Donor details
  draw(25, 524.54, [plain(`Name of the Donor : ${donationDetails.donorName}`)]);
  draw(25, 507.47, [plain(`Address : ${formatAddress(donationDetails.address)}`)]);
  draw(25, 490.4, [
    plain("Reference(Patronship No) :"),
    bold(` ${getDonorId(dccData)}`),
  ]);
  const sevak = [plain("Sevak Name : "), plain(sevakName)];
  draw(352, 490.4, sevak, { size: fitSize(sevak, RIGHT_EDGE + 15 - 352) });
  draw(25, 473.33, [plain("Phone : Res :")]);
  draw(127.3, 473.33, [plain("Off :")]);
  draw(352, 473.33, [plain(`Mobile : ${donationDetails.donorPhone}`)]);
  draw(25, 456.26, [
    plain("Tax exemption Required "),
    bold(donationDetails.pan ? "YES " : "NO "),
    plain("(Under section 80G, of the Income Tax Act)"),
  ]);
  const emailLine = [plain(`E-mail : ${email}`)];
  draw(25, 439.19, emailLine, { size: fitSize(emailLine, 345 - 25) });
  draw(352, 439.19, [plain(`PAN : ${donationDetails.pan || ""}`)]);

  // Amount and payment
  draw(25, 422.12, [
    plain("Rs. "),
    bold(`${Number(donationDetails.amount).toLocaleString("en-IN")} /-`),
  ]);
  const words = [plain("Rupees : "), bold(amountInWords(donationDetails.amount))];
  draw(134, 422.12, words, { size: fitSize(words, RIGHT_EDGE + 15 - 134) });
  draw(25, 405.05, [plain("by "), bold(paymentMode)]);
  const referenceLine = [plain(`Reference No : ${reference}`)];
  draw(134, 405.05, referenceLine, { size: fitSize(referenceLine, 345 - 134) });
  draw(352, 405.05, [plain(`Date : ${transactionDate}`)]);
  draw(25, 387.98, [plain("Bank :")]);
  draw(137.1, 387.98, [plain("Enrolled by "), bold(shortForm)]);
  draw(260.27, 387.98, [plain("CDC "), bold(shortForm)]);
  const towardsLine = [plain("Towards : "), bold(towards)];
  draw(352, 387.98, towardsLine, { size: fitSize(towardsLine, RIGHT_EDGE + 15 - 352) });
  draw(25, 370.91, [
    plain(
      "*Cheque Payment : Subject to realization. We do not accept anonymous donations.",
    ),
  ]);

  // Seal and footer
  page.drawImage(await pdfDoc.embedPng(SEAL_BYTES), {
    x: 461,
    y: 282.7,
    width: 50,
    height: 50,
  });
  draw(463.86, 267.7, [plain("for "), bold("HKM INDIA")]);
  draw(84.3, 253.63, [
    plain(
      "Regd. & Head office : Sri Radha Vrindavan Chandra Mandir, Chatikara Road, Vrindavan, Mathura District, U.P. - 281 121",
    ),
  ], { size: 8 });
  draw(197.69, 239.97, [bold("You will get a confirmed receipt once it is accounted")], {
    size: 8,
  });
  draw(68.83, 223.31, [
    plain(
      "Hare Krishna Hare Krishna Krishna Krishna Hare Hare Hare Rama Hare Rama Rama Rama Hare Hare",
    ),
  ]);
  draw(127.7, 171.76, [
    plain(
      "*This is an electronically generated receipt, hence does not require signature",
    ),
  ]);

  return await pdfDoc.save();
};

export const recieptDownloadService = async (req, res) => {
  const id = req.params.id;
  if (!id) {
    throw new AppError(`donationId is required`, 400);
  }

  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(`Invalid id: ${id}`, 400);
  }

  const pdfBytes = await generateReceiptBuffer(id);
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": "attachment; filename=receipt.pdf",
  });

  res.send(Buffer.from(pdfBytes));
};
