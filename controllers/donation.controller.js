import { createDonationOrderService } from "../services/donation.service.js";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";

export const createDonationOrder = asyncHandlers(async (req, res) => {
  const { status, message, resObj } = await createDonationOrderService(req);

  response(res, status, message, resObj);
});
