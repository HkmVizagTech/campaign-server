import {
  createCampaignerService,
  getCampaignerService,
} from "../services/campaigner.service.js";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";

export const createCampaigner = asyncHandlers(async (req, res) => {
  const { status, message, newCampaigner } = await createCampaignerService(req);

  response(res, status, message, newCampaigner);
});

export const getCampaigners = asyncHandlers(async (req, res) => {
  const { status, message, campaigners, count } =
    await getCampaignerService(req);

  response(res, status, message, { campaigners, count });
});
