import { bucket } from "../config/GCS.config.js";

export const uploadToGCS = (file) => {
  return new Promise((resolve, reject) => {
    const filename = `${Date.now()}-${file.originalname}`;
    const blob = bucket.file(filename);

    const stream = blob.createWriteStream({
      resumable: false,
      contentType: file.mimetype,
    });

    stream.on("error", reject);
    stream.on("finish", async () => {
      resolve({ filename });
    });

    stream.end(file.buffer);
  });
};

export const deleteFromGCS = async (fileName) => {
  await bucket.file(fileName).delete();
};

export const getSignedImageUrl = async (filename) => {
  const [url] = await bucket.file(filename).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return url;
};
