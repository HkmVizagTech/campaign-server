import Register from "../models/register.modal.js";
import TempleDevote from "../models/templeDevote.model.js";
import { AppError } from "../utils/AppError.js";
import bcrypt, { genSalt } from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { sendOtpWhatsappMessage } from "./whatsapp.service.js";
import { normalizePhoneNumber } from "../utils/utils.js";

export const registerService = async (req) => {
  const { name, email, password, phoneNumber } = req.body;
  const role = req.headers["role"];

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
    role,
    ...(phoneNumber?.trim() && { phoneNumber: phoneNumber.trim() }),
  });

  return {
    status: 201,
    message: "Registered Successfully",
    newRegister,
  };
};

export const loginService = async (req) => {
  const { email, password } = req.body;

  if (!email?.trim()) {
    throw new AppError("Email is required", 400);
  }

  if (!password?.trim()) {
    throw new AppError("Password is required", 400);
  }

  const existingUser = await Register.findOne({ email });

  if (!existingUser) {
    throw new AppError(`Invalid credentials`, 401);
  }

  const isPassword = await bcrypt.compare(password, existingUser.password);

  if (!isPassword) {
    throw new AppError(`Invalid credentials`, 401);
  }

  const token = jwt.sign(
    {
      id: existingUser._id,
      name: existingUser.name,
      email: existingUser.email,
      role: existingUser.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    },
  );

  return {
    status: 200,
    message: "Login successfully",
    data: {
      token,
      name: existingUser.name,
      role: existingUser.role,
      isPasswordChanged: existingUser.isPasswordChanged,
    },
  };
};

export const resetPasswordService = async (req) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req?.user?.id;

  if (!oldPassword || !oldPassword?.trim()) {
    throw new AppError("Old password is required", 400);
  }

  if (!newPassword || !newPassword?.trim()) {
    throw new AppError("New Password is required", 400);
  }

  if (oldPassword === newPassword) {
    throw new AppError("New password must be different", 400);
  }

  const user = await Register.findById(userId);

  if (!user) {
    throw new AppError("Unauthorized", 401);
  }

  const isPassword = await bcrypt.compare(oldPassword, user.password);

  if (!isPassword) {
    throw new AppError("Incorrect old password", 400);
  }
  const salt = await genSalt(10);
  const newHashPassword = await bcrypt.hash(newPassword, salt);

  user.password = newHashPassword;
  user.isPasswordChanged = true;

  await user.save();

  return {
    status: 200,
    message: "Password changed successfully",
  };
};

export const getAdminDetailsService = async (req) => {
  const user = req.user;

  const details = await Register.findById(user.id).select(
    "-createdAt -updatedAt -password",
  );

  if (!details) {
    throw new AppError("Not found", 404);
  }

  return {
    status: 200,
    message: "details fetched successfully",
    data: details,
  };
};

const OTP_EXPIRY_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

// Phone lookup order: an explicit phone on the account itself (works for
// admins, who have no devotee record), then the linked TempleDevote phone.
const resolveUserPhone = async (user) => {
  if (user.phoneNumber) return user.phoneNumber;

  const templeDevote = await TempleDevote.findOne({ userId: user._id }).select(
    "phoneNumber",
  );
  return templeDevote?.phoneNumber || null;
};

const clearOtp = (user) => {
  user.resetOtpHash = null;
  user.resetOtpExpires = null;
  user.resetOtpAttempts = 0;
};

// Shared by password-reset and OTP-login: validates the code, enforces expiry
// and a max number of wrong attempts, and consumes the OTP on success.
const verifyAndConsumeOtp = async (user, otp) => {
  if (!user.resetOtpHash || !user.resetOtpExpires) {
    throw new AppError("No OTP requested. Please request a new OTP.", 400);
  }

  if (user.resetOtpExpires.getTime() < Date.now()) {
    clearOtp(user);
    await user.save();
    throw new AppError("OTP has expired. Please request a new one.", 400);
  }

  const isOtpValid = await bcrypt.compare(otp.trim(), user.resetOtpHash);

  if (!isOtpValid) {
    user.resetOtpAttempts = (user.resetOtpAttempts || 0) + 1;
    if (user.resetOtpAttempts >= OTP_MAX_ATTEMPTS) {
      clearOtp(user);
      await user.save();
      throw new AppError(
        "Too many wrong attempts. Please request a new OTP.",
        429,
      );
    }
    await user.save();
    throw new AppError("Invalid OTP", 400);
  }

  clearOtp(user);
  user.resetOtpLastSentAt = null;
};

export const requestPasswordResetOtpService = async (req) => {
  const { email } = req.body;

  if (!email || !email.trim()) {
    throw new AppError("Email is required", 400);
  }

  const user = await Register.findOne({ email: email.trim().toLowerCase() });

  if (!user) {
    throw new AppError("No account found for this email", 404);
  }

  const phone = await resolveUserPhone(user);

  if (!phone) {
    throw new AppError(
      "No phone number linked to this account. Please contact an admin to add one.",
      400,
    );
  }

  const normalizedPhone = normalizePhoneNumber(phone);

  if (!normalizedPhone) {
    throw new AppError(
      "The phone number linked to this account is invalid. Please contact an admin.",
      400,
    );
  }

  if (
    user.resetOtpLastSentAt &&
    Date.now() - user.resetOtpLastSentAt.getTime() <
      OTP_RESEND_COOLDOWN_SECONDS * 1000
  ) {
    const waitSeconds = Math.ceil(
      (OTP_RESEND_COOLDOWN_SECONDS * 1000 -
        (Date.now() - user.resetOtpLastSentAt.getTime())) /
        1000,
    );
    throw new AppError(
      `Please wait ${waitSeconds}s before requesting another OTP`,
      429,
    );
  }

  const otp = crypto.randomInt(100000, 999999).toString();
  const salt = await genSalt(10);

  user.resetOtpHash = await bcrypt.hash(otp, salt);
  user.resetOtpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  user.resetOtpLastSentAt = new Date();
  user.resetOtpAttempts = 0;
  await user.save();

  try {
    await sendOtpWhatsappMessage(normalizedPhone, "otp", otp);
  } catch (error) {
    clearOtp(user);
    user.resetOtpLastSentAt = null;
    await user.save();
    throw new AppError(
      "Could not send OTP on WhatsApp right now. Please try again shortly.",
      502,
    );
  }

  return {
    status: 200,
    message: `OTP sent to the WhatsApp number linked to this account, valid for ${OTP_EXPIRY_MINUTES} minutes`,
  };
};

export const resetPasswordWithOtpService = async (req) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !email.trim()) {
    throw new AppError("Email is required", 400);
  }
  if (!otp || !otp.trim()) {
    throw new AppError("OTP is required", 400);
  }
  if (!newPassword || newPassword.trim().length < 6) {
    throw new AppError("New password must be at least 6 characters", 400);
  }

  const user = await Register.findOne({ email: email.trim().toLowerCase() });

  if (!user) {
    throw new AppError("No account found for this email", 404);
  }

  await verifyAndConsumeOtp(user, otp);

  const salt = await genSalt(10);
  user.password = await bcrypt.hash(newPassword, salt);
  user.isPasswordChanged = true;
  await user.save();

  return {
    status: 200,
    message: "Password reset successfully. You can now log in.",
  };
};

// Passwordless login with the WhatsApp OTP — available to every role,
// including admin. The OTP is requested via requestPasswordResetOtpService.
export const loginWithOtpService = async (req) => {
  const { email, otp } = req.body;

  if (!email || !email.trim()) {
    throw new AppError("Email is required", 400);
  }
  if (!otp || !otp.trim()) {
    throw new AppError("OTP is required", 400);
  }

  const user = await Register.findOne({ email: email.trim().toLowerCase() });

  if (!user) {
    throw new AppError("Invalid credentials", 401);
  }

  await verifyAndConsumeOtp(user, otp);
  await user.save();

  const token = jwt.sign(
    {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

  return {
    status: 200,
    message: "Login successfully",
    data: {
      token,
      name: user.name,
      role: user.role,
      isPasswordChanged: user.isPasswordChanged,
    },
  };
};
