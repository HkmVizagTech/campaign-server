import ExcelJS from "exceljs";
import Campaign from "../models/campaign.model.js";
import Campaigner from "../models/campaigner.model.js";
import Donation from "../models/donation.model.js";
import TempleDevote from "../models/templeDevote.model.js";
import { AppError } from "../utils/AppError.js";
import mongoose from "mongoose";

export const cardSummaryService = async (req) => {
  const role = req?.user?.role;
  const userId = req?.user?.id;
  const campaignId = req?.query?.campaignId;

  if (!role || !userId) {
    throw new AppError("Unauthorized user", 401);
  }

  if (campaignId && !mongoose.isValidObjectId(campaignId)) {
    throw new AppError("Invalid campaignId", 400);
  }

  if (role === "admin") {
    const campaignFilter = campaignId
      ? { _id: campaignId }
      : { status: "active" };
    const campaign = await Campaign.findOne(campaignFilter).select(
      "targetAmount raisedAmount",
    );

    if (!campaign) {
      throw new AppError("Campaign not found", 404);
    }

    const campaignerFilter = {
      campaignId: campaign._id,
    };

    const donationFilter = {
      campaign: campaign._id,
      status: "success",
    };

    const [totalDonations, activeCampaigners, pendingCampaigners] =
      await Promise.all([
        Donation.countDocuments(donationFilter),
        Campaigner.countDocuments({ ...campaignerFilter, status: "active" }),
        Campaigner.countDocuments({ ...campaignerFilter, status: "pending" }),
      ]);

    return {
      status: 200,
      message: "Fetched card metric summary",
      data: {
        "Target Amount": campaign?.targetAmount || 0,
        "Total Raised": campaign?.raisedAmount || 0,
        "Total Donations": totalDonations,
        "Active Campaigners": activeCampaigners,
        "Pending Campaigners": pendingCampaigners,
      },
    };
  }

  if (role === "devotee") {
    const campaignFilter = campaignId ? { campaignId } : {};
    const devotee = await TempleDevote.findOne({ userId: userId }).select(
      "_id",
    );
    if (!devotee) {
      return {
        status: 200,
        message: "Devotee profile not found",
        data: {
          "Total Campaigners": 0,
          "Total Target": 0,
          "Total Raised": 0,
          "Total Donations": 0,
          "Pending Campaigners": 0,
        },
      };
    }
    const devoteeId = devotee._id;

    const campaigners = await Campaigner.find(
      {
        templeDevoteInTouch: devoteeId,
        status: "active",
        ...campaignFilter,
      },
      "_id targetAmount raisedAmount",
    );

    const campaignerIds = campaigners.map((c) => c._id);

    if (!campaignerIds.length) {
      return {
        status: 200,
        message: "No campaigners not found",
        data: {
          "Total Campaigners": 0,
          "Total Target": 0,
          "Total Raised": 0,
          "Total Donations": 0,
          "Pending Campaigners": 0,
        },
      };
    }
    const totals = campaigners.reduce(
      (acc, curr) => {
        acc.target += curr.targetAmount || 0;
        acc.raised += curr.raisedAmount || 0;
        return acc;
      },
      {
        target: 0,
        raised: 0,
      },
    );

    const [totalCampaigners, pendingCampaigners, totalDonations] =
      await Promise.all([
        Campaigner.countDocuments({
          templeDevoteInTouch: devotee?._id,
          status: "active",
          ...campaignFilter,
        }),
        Campaigner.countDocuments({
          templeDevoteInTouch: devotee?._id,
          status: "pending",
          ...campaignFilter,
        }),
        Donation.countDocuments({
          campaigner: { $in: campaignerIds },
          status: "success",
        }),
      ]);

    return {
      status: 200,
      message: "Fetched devotee dashboard summary",
      data: {
        "Total Campaigners": totalCampaigners || 0,
        "Total Target": totals?.target || 0,
        "Total Raised": totals?.raised || 0,
        "Total Donations": totalDonations || 0,
        "Pending Campaigners": pendingCampaigners || 0,
      },
    };
  }

  throw new AppError("Unauthorized role", 403);
};

export const donationTrendService = async (req) => {
  const role = req?.user?.role;
  const userId = req?.user?.id;
  const campaignId = req?.query?.campaignId;

  if (!role || !userId) {
    throw new AppError("Unauthorized user", 401);
  }

  if (campaignId && !mongoose.isValidObjectId(campaignId)) {
    throw new AppError("Invalid campaignId", 400);
  }

  if (role === "admin") {
    const matchFilter = {
      status: "success",
      ...(campaignId && { campaign: new mongoose.Types.ObjectId(campaignId) }),
    };

    const trends = await Donation.aggregate([
      {
        $match: matchFilter,
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
            },
          },
          total: {
            $sum: "$amount",
          },
        },
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          amount: "$total",
        },
      },
      {
        $sort: {
          date: -1,
        },
      },
      {
        $limit: 7,
      },
      {
        $sort: {
          date: 1,
        },
      },
    ]);

    return {
      status: 200,
      message: "trends fetched successfully",
      data: trends,
    };
  }

  if (role === "devotee") {
    const devotee = await TempleDevote.findOne({ userId: userId }).select(
      "_id",
    );
    if (!devotee) {
      return {
        status: 200,
        message: "Devotee Not found",
        data: [],
      };
    }

    const campaigners = await Campaigner.find(
      {
        templeDevoteInTouch: devotee._id,
        status: "active",
        ...(campaignId && { campaignId }),
      },
      "_id",
    );

    const campaignerIds = campaigners.map((c) => c._id);

    if (!campaignerIds.length) {
      return {
        status: 200,
        message: "No campaigners found",
        data: [],
      };
    }

    const trends = await Donation.aggregate([
      {
        $match: {
          campaigner: { $in: campaignerIds },
          status: "success",
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
            },
          },
          total: {
            $sum: "$amount",
          },
        },
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          amount: "$total",
        },
      },
      {
        $sort: {
          date: -1,
        },
      },
      {
        $limit: 7,
      },
      {
        $sort: {
          date: 1,
        },
      },
    ]);

    return {
      status: 200,
      message: "trends fetched successfully",
      data: trends,
    };
  }

  throw new AppError("Unauthorized role", 403);
};

export const devoteeReportService = async (req) => {
  const { fromDate, toDate, campaignId } = req.query;

  if (campaignId && !mongoose.isValidObjectId(campaignId)) {
    throw new AppError("Invalid campaignId", 400);
  }

  // Build donation date filter
  const donationDateFilter = {};
  if (fromDate) {
    const from = new Date(fromDate);
    if (isNaN(from)) throw new AppError("Invalid fromDate", 400);
    donationDateFilter.$gte = from;
  }
  if (toDate) {
    const to = new Date(toDate);
    if (isNaN(to)) throw new AppError("Invalid toDate", 400);
    to.setHours(23, 59, 59, 999);
    donationDateFilter.$lte = to;
  }

  const campaignerMatchStage = {};
  if (campaignId) {
    campaignerMatchStage.campaignId = new mongoose.Types.ObjectId(campaignId);
  }

  const pipeline = [
    // Start from all campaigners (show 0-donation devotees too)
    { $match: campaignerMatchStage },

    // Join devotee info
    {
      $lookup: {
        from: "templedevotes",
        localField: "templeDevoteInTouch",
        foreignField: "_id",
        as: "devoteInfo",
      },
    },
    { $unwind: { path: "$devoteInfo", preserveNullAndEmptyArrays: false } },

    // Aggregate donations per campaigner with optional date filter
    {
      $lookup: {
        from: "donations",
        let: { campId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$campaigner", "$$campId"] },
              status: "success",
              ...(Object.keys(donationDateFilter).length && {
                createdAt: donationDateFilter,
              }),
            },
          },
          {
            $group: {
              _id: null,
              totalRaised: { $sum: "$amount" },
              donorCount: { $sum: 1 },
            },
          },
        ],
        as: "donationStats",
      },
    },

    // Group by devotee
    {
      $group: {
        _id: "$templeDevoteInTouch",
        devoteeName: { $first: "$devoteInfo.devoteName" },
        shortForm: { $first: "$devoteInfo.shortForm" },
        phoneNumber: { $first: "$devoteInfo.phoneNumber" },
        devoteeID: { $first: "$devoteInfo.devoteeID" },
        campaigners: {
          $push: {
            _id: "$_id",
            name: "$name",
            status: "$status",
            slug: "$slug",
            phoneNumber: "$phoneNumber",
            targetAmount: "$targetAmount",
            raisedAmount: {
              $ifNull: [
                { $arrayElemAt: ["$donationStats.totalRaised", 0] },
                0,
              ],
            },
            donorCount: {
              $ifNull: [
                { $arrayElemAt: ["$donationStats.donorCount", 0] },
                0,
              ],
            },
          },
        },
        totalRaised: {
          $sum: {
            $ifNull: [
              { $arrayElemAt: ["$donationStats.totalRaised", 0] },
              0,
            ],
          },
        },
        donorCount: {
          $sum: {
            $ifNull: [
              { $arrayElemAt: ["$donationStats.donorCount", 0] },
              0,
            ],
          },
        },
      },
    },

    // Sort by most raised
    { $sort: { totalRaised: -1, devoteeName: 1 } },
  ];

  const results = await Campaigner.aggregate(pipeline);

  const grandTotal = results.reduce(
    (acc, d) => {
      acc.totalRaised += d.totalRaised;
      acc.donorCount += d.donorCount;
      return acc;
    },
    { totalRaised: 0, donorCount: 0 },
  );

  return {
    status: 200,
    message: "Devotee report fetched successfully",
    data: { devotees: results, grandTotal },
  };
};

export const prasadamReportService = async (req) => {
  const { fromDate, toDate, campaignId, page = 1, pageSize = 50 } = req.query;

  if (campaignId && !mongoose.isValidObjectId(campaignId)) {
    throw new AppError("Invalid campaignId", 400);
  }

  const filter = {
    status: "success",
    prasadam: true,
  };

  if (campaignId) {
    filter.campaign = new mongoose.Types.ObjectId(campaignId);
  }

  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) {
      const from = new Date(fromDate);
      if (isNaN(from)) throw new AppError("Invalid fromDate", 400);
      filter.createdAt.$gte = from;
    }
    if (toDate) {
      const to = new Date(toDate);
      if (isNaN(to)) throw new AppError("Invalid toDate", 400);
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }

  const skip = (Number(page) - 1) * Number(pageSize);

  const [donors, total] = await Promise.all([
    Donation.find(filter)
      .select(
        "donorName donorPhone donorEmail amount address prasadam receiptNumber createdAt campaigner isAnonymous",
      )
      .populate("campaigner", "name slug")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(pageSize)),
    Donation.countDocuments(filter),
  ]);

  return {
    status: 200,
    message: "Prasadam donors fetched successfully",
    data: {
      donors,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(pageSize)),
      },
    },
  };
};


const safeSheetName = (raw, used) => {
  // Excel: max 31 chars, none of [ ] : * ? / \\, must be unique (case-insens.)
  let base = String(raw || "Devotee")
    .replace(/[\[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || "Devotee";
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
};

// One sheet per devotee listing their campaigners: name, phone, target.
export const devoteeCampaignersWorkbookService = async (req) => {
  const { campaignId } = req.query;

  if (campaignId && !mongoose.isValidObjectId(campaignId)) {
    throw new AppError("Invalid campaignId", 400);
  }

  const match = {};
  if (campaignId) match.campaignId = new mongoose.Types.ObjectId(campaignId);

  const campaigners = await Campaigner.find(match)
    .select("name phoneNumber targetAmount status templeDevoteInTouch")
    .populate("templeDevoteInTouch", "devoteName shortForm phoneNumber")
    .sort({ name: 1 })
    .lean();

  // Group by devotee
  const byDevotee = new Map();
  for (const c of campaigners) {
    const d = c.templeDevoteInTouch;
    const key = d?._id ? String(d._id) : "unassigned";
    if (!byDevotee.has(key)) {
      byDevotee.set(key, {
        devoteeName: d?.devoteName || "Unassigned",
        shortForm: d?.shortForm || "",
        campaigners: [],
      });
    }
    byDevotee.get(key).campaigners.push(c);
  }

  const devotees = [...byDevotee.values()].sort((a, b) =>
    a.devoteeName.localeCompare(b.devoteeName),
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "HKM Vizag Campaigner Platform";
  wb.created = new Date();

  const headerFill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8EEF7" },
  };
  const styleHeader = (row) => {
    row.font = { bold: true };
    row.fill = headerFill;
    row.alignment = { vertical: "middle" };
  };

  const used = new Set(["summary"]);
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Devotee", key: "devotee", width: 30 },
    { header: "Campaigners", key: "count", width: 14 },
    { header: "Total Target (₹)", key: "target", width: 18, style: { numFmt: "#,##0" } },
  ];
  styleHeader(summary.getRow(1));

  let grandTarget = 0;
  let grandCount = 0;

  for (const d of devotees) {
    const sheet = wb.addWorksheet(
      safeSheetName(d.shortForm ? `${d.devoteeName} (${d.shortForm})` : d.devoteeName, used),
    );

    sheet.columns = [
      { header: "S.No", key: "sno", width: 7 },
      { header: "Campaigner Name", key: "name", width: 32 },
      { header: "Phone Number", key: "phone", width: 16 },
      { header: "Target (₹)", key: "target", width: 14, style: { numFmt: "#,##0" } },
      { header: "Status", key: "status", width: 12 },
    ];
    styleHeader(sheet.getRow(1));
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    let total = 0;
    d.campaigners.forEach((c, i) => {
      total += c.targetAmount || 0;
      sheet.addRow({
        sno: i + 1,
        name: c.name,
        // keep as text so Excel doesn't drop leading zeros / use sci. notation
        phone: String(c.phoneNumber || ""),
        target: c.targetAmount || 0,
        status: c.status || "",
      });
    });

    const totalRow = sheet.addRow({ name: "Total", target: total });
    totalRow.font = { bold: true };

    summary.addRow({
      devotee: d.shortForm ? `${d.devoteeName} (${d.shortForm})` : d.devoteeName,
      count: d.campaigners.length,
      target: total,
    });
    grandTarget += total;
    grandCount += d.campaigners.length;
  }

  const grand = summary.addRow({
    devotee: "Grand Total",
    count: grandCount,
    target: grandTarget,
  });
  grand.font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, sheets: devotees.length };
};
