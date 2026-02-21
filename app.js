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
app.use("/api/campaign", campaignRouter);
app.use("/api/campaigner", campaignerRouter);
app.use("/api/devote", devoteRouter);

import { errorHandler } from "./utils/handlers.js";

app.use(errorHandler);

export default app;
