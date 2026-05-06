import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import Donation from "../models/donation.model.js";
import * as fontkit from "fontkit";
import fs from "fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import numToWord from "number-to-words";
import path from "path";

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

const getReceiptFont = async (pdfDoc) => {
  pdfDoc.registerFontkit(fontkit);

  for (const fontPath of DEFAULT_RECEIPT_FONT_PATHS) {
    if (!fs.existsSync(fontPath)) {
      continue;
    }

    try {
      if (path.extname(fontPath).toLowerCase() === ".ttc") {
        console.warn(
          `Skipping receipt font collection ${fontPath}. Use a .ttf or .otf font file instead.`,
        );
        continue;
      }

      const fontBytes = fs.readFileSync(fontPath);

      return {
        font: await pdfDoc.embedFont(fontBytes),
        sanitize: false,
        fontPath,
      };
    } catch (error) {
      console.warn(
        `Failed to embed receipt font at ${fontPath}: ${error.message}`,
      );
    }
  }

  console.warn(
    "No Unicode receipt font found. Falling back to Helvetica and text sanitization.",
  );

  return {
    font: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    sanitize: true,
    fontPath: null,
  };
};

const preparePdfText = (value, fieldName, sanitize) =>
  sanitize ? sanitizePdfText(value, fieldName) : value == null ? "" : String(value);

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

  const amountWords =
    numToWord.toWords(donationDetails.amount).toUpperCase() + " RUPEES ONLY";

  const formattedDate = new Date(donationDetails.createdAt).toLocaleDateString(
    "en-IN",
  );

  const taxExemption = donationDetails.pan ? "YES" : "NO";

  const addressParts = donationDetails?.address
    ? Object.values(donationDetails.address).filter(Boolean)
    : [];

  const address = addressParts.length ? addressParts.join(", ") : "---";

  const templatePath = path.join(process.cwd(), "receipt-template.pdf");

  const existingPdf = fs.readFileSync(templatePath);
  const shortForm = donationDetails?.campaigner?.templeDevoteInTouch?.shortForm;
  const SF = shortForm ? shortForm : "---";

  const pdfDoc = await PDFDocument.load(existingPdf);
  const seva = "Mandir Nirman Seva";
  const email = donationDetails?.donorEmail
    ? donationDetails?.donorEmail
    : "---";
  const pan = donationDetails?.pan ? donationDetails?.pan : "---";
  const { font, sanitize, fontPath } = await getReceiptFont(pdfDoc);
  const form = pdfDoc.getForm();

  if (fontPath) {
    console.log(`Using receipt font: ${fontPath}`);
  }

  form
    .getTextField("name")
    .setText(
      preparePdfText(donationDetails.donorName.toUpperCase(), "name", sanitize),
    );
  form
    .getTextField("phoneNum")
    .setText(preparePdfText(donationDetails.donorPhone, "phoneNum", sanitize));
  form
    .getTextField("inWords")
    .setText(preparePdfText(amountWords, "inWords", sanitize));
  form
    .getTextField("transactionDate")
    .setText(preparePdfText(formattedDate, "transactionDate", sanitize));
  form
    .getTextField("transaction_Date")
    .setText(preparePdfText(formattedDate, "transaction_Date", sanitize));
  form.getTextField("address").setText(preparePdfText(address, "address", sanitize));
  form.getTextField("80G").setText(preparePdfText(taxExemption, "80G", sanitize));
  form.getTextField("towards").setText(preparePdfText(seva, "towards", sanitize));
  form.getTextField("email").setText(preparePdfText(email, "email", sanitize));
  form.getTextField("enrolledBy").setText(preparePdfText(SF, "enrolledBy", sanitize));
  form.getTextField("pan").setText(preparePdfText(pan, "pan", sanitize));
  form
    .getTextField("receiptNumber")
    .setText(
      preparePdfText(
        donationDetails?.dccApiResponse?.data?.ReceiptNumber?.split("|").join(
          " | ",
        ) || "",
        "receiptNumber",
        sanitize,
      ),
    );
  console.log(
    "receipt Number: ",
    donationDetails?.dccApiResponse?.data?.ReceiptNumber?.split("|").join(" | "),
  );
  form
    .getTextField("amount")
    .setText(
      preparePdfText(
        `${donationDetails.amount.toLocaleString("en-IN")}/-`,
        "amount",
        sanitize,
      ),
    );

  form
    .getTextField("transactionNumber")
    .setText(
      preparePdfText(
        donationDetails.gatewayPaymentId,
        "transactionNumber",
        sanitize,
      ),
    );

  const fields = form.getFields();
  fields.forEach((field) => {
    if (field.updateAppearances) {
      field.updateAppearances(font);
    }
  });
  form.flatten();

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
