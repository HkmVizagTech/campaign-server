import express from "express";
import { createCampaigner } from "../controllers/campaigner.controller.js";

const campaignerRouter = express.Router();

campaignerRouter.post("/", createCampaigner);
