import express from "express";
import {
  getAdminDetails,
  login,
  register,
  resetPassword,
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

export default registerRouter;
