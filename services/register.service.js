import Register from "../models/register.modal.js";
import { AppError } from "../utils/AppError.js";
import bcrypt from "bcrypt";

export const registerService = async (req) => {
  const { name, email, password } = req.body;

  if (!name || !name.trim()) {
    throw new AppError("name is required", 400);
  }

  if (!email || !email.trim()) {
    throw new AppError("email is required", 400);
  }

  if (!password || !password.trim()) {
    throw new AppError("password is required", 400);
  }

  const userExist = await Register.findOne({ email });

  if (userExist) {
    throw new AppError("User already exist", 400);
  }

  const salt = await bcrypt.genSalt(10);
  const hashPassword = await bcrypt.hash(password, salt);

  const newRegister = await Register.create({
    name,
    email,
    password: hashPassword,
    role: "admin",
  });

  return {
    status: 201,
    message: "Registered Successfully",
    newRegister,
  };
};
