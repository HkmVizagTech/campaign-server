import { registerService } from "../services/register.service.js";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";

export const register = asyncHandlers(async (req, res) => {
  const { status, message, newRegister } = await registerService(req);

  response(res, status, message, newRegister);
});
