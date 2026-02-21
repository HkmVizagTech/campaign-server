import express from "express";
import { createCampaign } from "../controllers/campaign.controller.js";

const campaignRouter = express.Router();

campaignRouter.post("/", createCampaign);

export default campaignRouter;
