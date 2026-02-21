import express from "express";
import { createCampaigner } from "../controllers/campaigner.controller.js";
import { upload } from "../middlewares/multer.middleware.js";

const campaignerRouter = express.Router();

campaignerRouter.post("/", upload.single("image"), createCampaigner);

export default campaignerRouter;
