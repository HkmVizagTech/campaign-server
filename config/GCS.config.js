import { Storage } from "@google-cloud/storage";
import dotenv from "dotenv";
dotenv.config();

const creds = JSON.parse(process.env.GCS_CREDENTIALS);

creds.private_key = creds?.private_key.replace(/\\n/g, "\n");

const storage = new Storage({
  credentials: creds,
  projectId: process.env.GCS_PROJECT_ID,
});

const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

export { bucket };
