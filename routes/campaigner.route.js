import express from "express";
import {
  createCampaigner,
  deleteCampaigner,
  getCampaigners,
  getLastestDonorofCampaigner,
  getSingleCampaigner,
  getTopDonors,
  updateCampaigner,
} from "../controllers/campaigner.controller.js";
import { upload } from "../middlewares/multer.middleware.js";
import {
  optionalAuth,
  verifyToken,
} from "../middlewares/verifyToken.middleware.js";
import { campaignerStatus } from "../middlewares/campaignerStatus.middleware.js";
import { onlyAdmin } from "../middlewares/onlyAdmin.middleware.js";

const campaignerRouter = express.Router();

campaignerRouter.post(
  "/",
  upload.single("image"),
  optionalAuth,
  campaignerStatus,
  createCampaigner,
);

// Dynamic Routes
campaignerRouter.get("/topdonors/:campaignId", getTopDonors);
campaignerRouter.get(
  "/latestDonors/:campaignId/:slug",
  getLastestDonorofCampaigner,
);
campaignerRouter.get("/details/:slugId/", getSingleCampaigner);
campaignerRouter.get("/:campaignId", getCampaigners);
campaignerRouter.put("/:id", verifyToken,onlyAdmin, updateCampaigner);
campaignerRouter.delete("/:id", verifyToken,onlyAdmin, deleteCampaigner);
export default campaignerRouter;
