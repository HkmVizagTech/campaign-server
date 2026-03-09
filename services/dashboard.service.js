import Campaign from "../models/campaign.model.js";
import Campaigner from "../models/campaigner.model.js";
import Donation from "../models/donation.model.js";

export const cardSummaryService = async () => {
  const [campaign, totalDonations, activeCampaigners, pendingCampaigners] =
    await Promise.all([
      Campaign.findOne({ status: "active" }).select(
        "targetAmount raisedAmount",
      ),
      Donation.countDocuments({ status: "success" }),
      Campaigner.countDocuments({ status: "active" }),
      Campaigner.countDocuments({ status: "pending" }),
    ]);

  return {
    status: 200,
    message: "Fetched card metric summary",
    data: {
      targetAmount: campaign?.targetAmount || 0,
      totalRaised: campaign?.raisedAmount || 0,
      totalDonations,
      activeCampaigners,
      pendingCampaigners,
    },
  };
};

export const donationTrendService = async () => {
  const trends = await Donation.aggregate([
    {
      $match: {
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
};
