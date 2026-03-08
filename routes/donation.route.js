import express from "express";
import {
  createDonationOrder,
  getDonorDetails,
  getDonors,
} from "../controllers/donation.controller.js";

const donationRouter = express.Router();

donationRouter.post("/create-order", createDonationOrder);
donationRouter.get("/", getDonors);

donationRouter.get("/:donationId", getDonorDetails);

export default donationRouter;
