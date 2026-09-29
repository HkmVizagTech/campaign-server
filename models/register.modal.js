import mongoose from "mongoose";

const registerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
      enum: ["admin", "devotee", "superAdmin"],
    },
    isPasswordChanged: { type: Boolean, default: false },
    resetOtpHash: { type: String, default: null },
    resetOtpExpires: { type: Date, default: null },
    resetOtpLastSentAt: { type: Date, default: null },
    resetOtpAttempts: { type: Number, default: 0 },
    // Optional WhatsApp number on the account itself — lets admins (who have
    // no linked devotee record) receive OTPs.
    phoneNumber: { type: String, trim: true, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const Register = mongoose.model("Register", registerSchema);

export default Register;
