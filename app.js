import express from "express";
import cors from "cors";
const app = express();

app.use(express.json());
app.use(cors());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

import campaignRouter from "./routes/campaign.route.js";
import campaignerRouter from "./routes/campaigner.route.js";
import devoteRouter from "./routes/templeDevote.route.js";
import registerRouter from "./routes/register.route.js";
import donationRouter from "./routes/donation.route.js";

app.use("/api", registerRouter);
app.use("/api/campaign", campaignRouter);
app.use("/api/campaigner", campaignerRouter);
app.use("/api/devote", devoteRouter);
app.use("api/donations", donationRouter);

import { errorHandler } from "./utils/handlers.js";

app.use(errorHandler);

export default app;
