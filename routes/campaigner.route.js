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
import { authorizeRole } from "../middlewares/onlyAdmin.middleware.js";

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
campaignerRouter.get("/details/:slugId/:campaignId", getSingleCampaigner);
campaignerRouter.get("/:campaignId", getCampaigners);
campaignerRouter.get("/admin/:campaignId", optionalAuth, getCampaigners);
campaignerRouter.patch(
  "/:id",
  verifyToken,
  authorizeRole("admin", "devotee"),
  upload.single("image"),
  updateCampaigner,
);
campaignerRouter.delete(
  "/:id",
  verifyToken,
  authorizeRole("admin", "devotee"),
  deleteCampaigner,
);
export default campaignerRouter;
