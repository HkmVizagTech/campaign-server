import {
  cardSummaryService,
  devoteeCampaignersWorkbookService,
  devoteeReportService,
  donationTrendService,
  prasadamReportService,
} from "../services/dashboard.service.js";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";

export const cardSummary = asyncHandlers(async (req, res) => {
  const { status, message, data } = await cardSummaryService(req);
  response(res, status, message, data);
});

export const donationTrend = asyncHandlers(async (req, res) => {
  const { status, message, data } = await donationTrendService(req);
  response(res, status, message, data);
});

export const devoteeReport = asyncHandlers(async (req, res) => {
  const { status, message, data } = await devoteeReportService(req);
  response(res, status, message, data);
});

export const prasadamReport = asyncHandlers(async (req, res) => {
  const { status, message, data } = await prasadamReportService(req);
  response(res, status, message, data);
});

export const devoteeCampaignersExport = asyncHandlers(async (req, res) => {
  const { buffer } = await devoteeCampaignersWorkbookService(req);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="devotee-wise-campaigners-${new Date().toISOString().slice(0, 10)}.xlsx"`,
  );
  res.send(Buffer.from(buffer));
});
