import {
  getAdminDetailsService,
  loginService,
  registerService,
  requestPasswordResetOtpService,
  resetPasswordService,
  resetPasswordWithOtpService,
} from "../services/register.service.js";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";

export const register = asyncHandlers(async (req, res) => {
  const { status, message, newRegister } = await registerService(req);

  response(res, status, message, newRegister);
});

export const login = asyncHandlers(async (req, res) => {
  const { status, message, data } = await loginService(req);
  response(res, status, message, data);
});

export const getAdminDetails = asyncHandlers(async (req, res) => {
  const { status, message, data } = await getAdminDetailsService(req);
  response(res, status, message, data);
});

export const resetPassword = asyncHandlers(async (req, res) => {
  const { status, message } = await resetPasswordService(req);
  response(res, status, message);
});

export const requestPasswordResetOtp = asyncHandlers(async (req, res) => {
  const { status, message } = await requestPasswordResetOtpService(req);
  response(res, status, message);
});

export const resetPasswordWithOtp = asyncHandlers(async (req, res) => {
  const { status, message } = await resetPasswordWithOtpService(req);
  response(res, status, message);
});
