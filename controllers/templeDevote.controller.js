import { createTempleDevoteService } from "../services/templeDevote.service.js";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";

export const createTempleDevote = asyncHandlers(async (req, res) => {
  const { status, message, newDevote } = await createTempleDevoteService(req);

  response(res, status, message, newDevote);
});
