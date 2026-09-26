import express from "express";
import {
  getAdminDetails,
  login,
  register,
  requestPasswordResetOtp,
  resetPassword,
  resetPasswordWithOtp,
} from "../controllers/register.controller.js";
import { verifyToken } from "../middlewares/verifyToken.middleware.js";
import { authorizeRole } from "../middlewares/onlyAdmin.middleware.js";

const registerRouter = express.Router();

registerRouter.post("/register", verifyToken, authorizeRole("admin"), register);
registerRouter.post("/login", login);
registerRouter.get(
  "/",
  verifyToken,
  authorizeRole("admin", "devotee"),
  getAdminDetails,
);

registerRouter.post("/reset-password", verifyToken, resetPassword);

// Public — no auth. This is exactly for the case where a devotee
// cannot log in at all.
registerRouter.post("/forgot-password", requestPasswordResetOtp);
registerRouter.post("/reset-password-otp", resetPasswordWithOtp);

export default registerRouter;
