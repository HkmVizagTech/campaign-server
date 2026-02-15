import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import streamifier from "streamifier";
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadToCloudinary = async (file) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "campaigners",
        resource_type: "image",
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );

    streamifier.createReadStream(file.buffer).pipe(uploadStream);
  });
};
export const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return;

  return cloudinary.uploader.destroy(publicId);
};
