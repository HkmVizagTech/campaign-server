import { createDonationOrderService } from "../services/donation.service";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";

export const createDonationOrder = asyncHandlers(async (req, res) => {
  const { status, message, res } = await createDonationOrderService(req);

  response(res, status, message, res);
});
