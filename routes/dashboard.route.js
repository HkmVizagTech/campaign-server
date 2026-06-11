import express from "express";
import {
  cardSummary,
  devoteeReport,
  donationTrend,
  prasadamReport,
} from "../controllers/dashboard.controller.js";
import { verifyToken } from "../middlewares/verifyToken.middleware.js";
import { authorizeRole } from "../middlewares/onlyAdmin.middleware.js";

const dashboardRouter = express.Router();

dashboardRouter.get("/summary", verifyToken, authorizeRole("admin", "devotee"), cardSummary);
dashboardRouter.get("/donation-trend", verifyToken, authorizeRole("admin", "devotee"), donationTrend);
dashboardRouter.get("/reports/devotee-summary", verifyToken, authorizeRole("admin", "superAdmin"), devoteeReport);
dashboardRouter.get("/reports/prasadam", verifyToken, authorizeRole("admin", "superAdmin"), prasadamReport);

export default dashboardRouter;
