import express from "express";
import {
  createDonationOrder,
  getDonors,
} from "../controllers/donation.controller.js";

const donationRouter = express.Router();

donationRouter.post("/create-order", createDonationOrder);
donationRouter.get("/", getDonors);

export default donationRouter;
