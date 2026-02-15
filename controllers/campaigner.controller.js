import { createCampaignerService } from "../services/campaigner.service.js";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";

export const createCampaigner = asyncHandlers(async (req, res) => {
  const { status, message, newCampaigner } = await createCampaignerService(req);

  response(res, status, message, newCampaigner);
});
