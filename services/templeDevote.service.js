import TempleDevote from "../models/templeDevote.model.js";
import { AppError } from "../utils/AppError.js";

export const createTempleDevoteService = async (req) => {
  const { name, phoneNumber } = req.body;

  if (!name || !name.trim()) {
    throw new AppError(`Devote name is required`, 400);
  }

  if (!phoneNumber) {
    throw new AppError(`Phone number is required`, 400);
  }

  const newDevote = await TempleDevote.create({
    devoteName: name,
    phoneNumber,
  });

  return {
    status: 201,
    message: "Devoted Created Successfully",
    newDevote,
  };
};
