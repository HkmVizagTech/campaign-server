import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
const noCache = (req, res, next) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
  next();
};
const app = express();
const allowedOrigin = [
  "http://localhost:5173",
  "https://iskcon-campaginer-vizag-client.vercel.app",
  "https://campaigns.harekrishnavizag.org",
  "https://campaigner-client-y2d2.vercel.app/",
];
import webhookRouter from "./routes/webhook.route.js";
app.use(
  "/api/webhooks/razorpay",
  bodyParser.raw({ type: "*/*", limit: "1mb" }),
  webhookRouter,
);
app.use(noCache);

app.use(express.json());

app.use(
  cors({
    origin: allowedOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

import campaignRouter from "./routes/campaign.route.js";
import campaignerRouter from "./routes/campaigner.route.js";
import devoteRouter from "./routes/templeDevote.route.js";
import registerRouter from "./routes/register.route.js";
import donationRouter from "./routes/donation.route.js";
import mediaRouter from "./routes/media.routes.js";
import paymentRouter from "./routes/payment.route.js";
import sevaRouter from "./routes/seva.route.js";
import dashboardRouter from "./routes/dashboard.route.js";
import recieptRouter from "./routes/receipt.route.js";

app.use("/api", registerRouter);
app.use("/api/campaign", campaignRouter);
app.use("/api/campaigner", campaignerRouter);
app.use("/api/devote", devoteRouter);
app.use("/api/donations", donationRouter);
app.use("/api/media", mediaRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/seva", sevaRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/receipt", recieptRouter);

import { errorHandler } from "./utils/handlers.js";
import { multerErrorHandler } from "./middlewares/multer.middleware.js";
app.use(multerErrorHandler);
app.use(errorHandler);

export default app;
