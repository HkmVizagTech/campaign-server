import express from "express";
import { createDonationOrder } from "../controllers/donation.controller.js";

const donationRouter = express.Router();

donationRouter.post("/create-order", createDonationOrder);

export default donationRouter;
