import express from "express";
import {
  createCampaigner,
  getCampaigners,
} from "../controllers/campaigner.controller.js";
import { upload } from "../middlewares/multer.middleware.js";

const campaignerRouter = express.Router();

campaignerRouter.post("/", upload.single("image"), createCampaigner);
campaignerRouter.get("/:campaignId", getCampaigners);

export default campaignerRouter;
