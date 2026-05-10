// utils/R2.js
import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client, bucketName } from "../config/R2.config.js";
import sharp from "sharp";
import { AppError } from "./AppError.js";

export const uploadToR2 = async (file) => {
  if (!["image/jpeg", "image/jpg", "image/png"].includes(file.mimetype)) {
    throw new AppError("Only JPG, JPEG, and PNG images are allowed", 400);
  }

  let compressedBuffer;
  if (file.mimetype === "image/jpeg" || file.mimetype === "image/jpg") {
    compressedBuffer = await sharp(file.buffer)
      .resize({ width: 500 })
      .jpeg({ quality: 60, mozjpeg: true })
      .toBuffer();
  } else if (file.mimetype === "image/png") {
    compressedBuffer = await sharp(file.buffer)
      .resize({ width: 500 })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  const ext = file.mimetype.split("/")[1];
  const filename = `${Date.now()}-${file.originalname
    .split(".")[0]
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9.-]/g, "")}.${ext}`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: filename,
      Body: compressedBuffer,
      ContentType: file.mimetype,
    }),
  );

  const url = `${process.env.R2_PUBLIC_URL}/${filename}`;

  return { filename, url };
};

export const deleteFromR2 = async (fileName) => {
  if (!fileName) throw new Error("File name is required");

  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: fileName,
    }),
  );
};

export const getSignedImageUrl = async (filename) => {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: filename,
  });

  const url = await getSignedUrl(r2Client, command, {
    expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
  });

  return url;
};
