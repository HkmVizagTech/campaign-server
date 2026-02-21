import { createCampaignService } from "../services/campaign.service.js";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";

export const createCampaign = asyncHandlers(async (req, res) => {
  const { status, message, campaign } = await createCampaignService(req);

  response(res, status, message, campaign);
});
