import mongoose from "mongoose";
import TempleDevote from "../models/templeDevote.model.js";
import { AppError } from "../utils/AppError.js";
import Register from "../models/register.modal.js";
import bcrypt from "bcrypt";
import Campaigner from "../models/campaigner.model.js";

export const createTempleDevoteService = async (req) => {
  const { name, phoneNumber, email, shortForm } = req.body;

  if (!name || !name.trim()) {
    throw new AppError(`Devote name is required`, 400);
  }

  if (!phoneNumber) {
    throw new AppError(`Phone number is required`, 400);
  }

  if (!email || !email.trim()) {
    throw new AppError(`Devote Mail is required`, 400);
  }

  if (!shortForm || !shortForm.trim()) {
    throw new AppError(`Short Form is required`, 400);
  }

  const normalizeEmail = email.trim().toLowerCase();

  const isExist = await TempleDevote.findOne({ email: normalizeEmail });

  if (isExist) {
    throw new AppError(`Devote with same mail is already exist`, 400);
  }

  const userExists = await Register.findOne({ email: normalizeEmail });
  if (userExists) {
    throw new AppError(`User with same email already exists`, 400);
  }
  const salt = await bcrypt.genSalt(10);
  const hashPassword = await bcrypt.hash(phoneNumber, salt);

  const newRegistration = await Register.create({
    name,
    email: normalizeEmail,
    password: hashPassword,
    role: "devotee",
  });

  const newDevote = await TempleDevote.create({
    devoteName: name,
    phoneNumber,
    email: normalizeEmail,
    userId: newRegistration._id,
    shortForm,
  });

  return {
    status: 201,
    message: "Devoted Created Successfully",
    newDevote,
  };
};

export const getTempleDevotesService = async (req) => {
  let filter = {};

  if (req.query.search) {
    filter.$or = [
      {
        devoteName: {
          $regex: req.query.search,
          $options: "i",
        },
      },
      { phoneNumber: { $regex: req.query.search } },
    ];
  }

  const devotes = await TempleDevote.find(filter)
    .sort({ devoteName: 1 })
    .select("-createdAt -updatedAt");

  return {
    status: 200,
    message: "Fetched Devotes list",
    devotes,
  };
};

export const deleteDevoteService = async (req) => {
  const id = req.params.id;

  if (!id) {
    throw new AppError(`id is required`, 400);
  }

  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(`Invalid Id: ${id}`, 400);
  }

  const campaignerExists = await Campaigner.exists({
    templeDevoteInTouch: id,
  });

  if (campaignerExists) {
    throw new AppError(
      "Cannot delete devotee because campaigners are assigned to this devotee",
      400,
    );
  }

  const deletedDevote = await TempleDevote.findByIdAndDelete(id);

  if (!deletedDevote) {
    throw new AppError("Not Found", 404);
  }

  await Register.findByIdAndUpdate(deletedDevote.userId);

  return {
    status: 200,
    message: "deleted Successfully",
    data: deletedDevote,
  };
};

export const updateDevoteeService = async (req) => {
  const id = req.params.id;

  if (!id) {
    throw new AppError(`id is required`, 400);
  }

  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(`Invalid Id: ${id}`, 400);
  }

  const devotee = await TempleDevote.findById(id);

  if (!devotee) {
    throw new AppError("Devotee not found", 404);
  }

  const oldPhoneNumber = devotee.phoneNumber;

  const updateData = Object.fromEntries(
    Object.entries(req.body).filter(([_, value]) => value !== undefined),
  );

  delete updateData._id;
  delete updateData.email;

  const updatedDevotee = await TempleDevote.findByIdAndUpdate(
    id,
    { $set: updateData },
    { returnDocument: "after", runValidators: true },
  );

  const register = await Register.findById(updatedDevotee.userId);

  if (
    register &&
    !register.isPasswordChanged &&
    updateData.phoneNumber &&
    updateData.phoneNumber !== oldPhoneNumber
  ) {
    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(updateData.phoneNumber, salt);

    register.password = hashPassword;
    await register.save();
  }

  return {
    status: 200,
    message: "Devote Updated successfully",
    data: updatedDevotee,
  };
};

export const singleDevoteeService = async (req) => {
  const id = req.params.id;

  if (!id) {
    throw new AppError(`id is required`, 400);
  }

  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(`Invalid Id: ${id}`, 400);
  }

  const devotee = await TempleDevote.findById(id);

  if (!devotee) {
    throw new AppError("Devotee not found", 404);
  }

  return {
    status: 200,
    message: "Single Devotee Details fetched",
    data: devotee,
  };
};
