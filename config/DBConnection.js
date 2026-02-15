import mongoose from "mongoose";

export const connectToDB = async () => {
  try {
    await mongoose.connect(process.env.DB_URL);
    console.log("DB connected successfully");
  } catch (error) {
    console.log("DB connection failed: ", error);
    process.exit(1);
  }
};
