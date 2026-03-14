import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import Campaign from "../models/campaign.model.js";
import Media from "../models/media.model.js";
import Campaigner from "../models/campaigner.model.js";
import { uploadToGCS } from "../utils/GCS.js";
import TempleDevote from "../models/templeDevote.model.js";
import Donation from "../models/donation.model.js";
import slugify from "slugify";
import { sendWhatsappMessage } from "./whatsapp.service.js";

export const createCampaignerService = async (req) => {
  const {
    name,
    campaignId,
    targetAmount,
    imageId,
    phoneNumber,
    templeDevoteInTouch,
  } = req.body;

  const requiredFields = [
    "name",
    "campaignId",
    "targetAmount",
    "phoneNumber",
    "templeDevoteInTouch",
  ];

  for (let field of requiredFields) {
    if (
      req.body[field] === undefined ||
      req.body[field] === null ||
      req.body[field] === ""
    ) {
      throw new AppError(`${field} is required`, 400);
    }
  }

  if (!mongoose.isValidObjectId(templeDevoteInTouch)) {
    throw new AppError(`Invalid Devote ID: ${templeDevoteInTouch}`, 400);
  }

  const templeDevote = await TempleDevote.findById(templeDevoteInTouch);

  if (!templeDevote) {
    throw new AppError("TempleDevote not found", 404);
  }

  if (Number(targetAmount) <= 0) {
    throw new AppError("Target amount must be greater than 0", 400);
  }

  if (!mongoose.isValidObjectId(campaignId)) {
    throw new AppError(`Invalid campaignId: ${campaignId}`, 400);
  }

  const campaignExist = await Campaign.findOne({
    _id: campaignId,
    status: {
      $ne: "closed",
    },
  });

  if (!campaignExist) {
    throw new AppError(`Campaign not exist`, 404);
  }

  const exist = await Campaigner.findOne({ name, campaignId });

  if (exist) {
    throw new AppError(`Campaigner is already exists for this campaign`, 409);
  }

  let imageResult;

  if (imageId) {
    if (!mongoose.isValidObjectId(imageId)) {
      throw new AppError(`Invalid imageId: ${imageId}`, 400);
    }

    const media = await Media.findById(imageId);

    if (!media) {
      throw new AppError(`Image not found for this ID: ${imageId}`, 404);
    }

    imageResult = {
      filename: media.image.filename,
      url: media.image.url,
    };
  } else {
    if (!req.file) {
      throw new AppError(`Image File is required`, 400);
    }

    const uploadResult = await uploadToGCS(req.file);

    if (!uploadResult.filename || !uploadResult.url) {
      throw new AppError(`Image upload failed`, 500);
    }

    const media = await Media.create({
      name,
      image: {
        filename: uploadResult?.filename,
        url: uploadResult?.url,
      },
    });

    imageResult = {
      filename: media.image.filename,
      url: media.image.url,
    };
  }

  const slug = slugify(name, {
    lower: true,
    strict: true,
    trim: true,
  });
  const existingSlug = await Campaigner.findOne({ slug });

  if (existingSlug) {
    throw new AppError("Campaigner with this name already exists", 409);
  }
  const newCampaigner = await Campaigner.create({
    name,
    slug,
    phoneNumber,
    campaignId,
    templeDevoteInTouch,
    targetAmount,
    status: req?.campaignerStatus,
    image: {
      filename: imageResult?.filename,
      url: imageResult?.url,
    },
  });

  const campaignerPhoneNumber = newCampaigner.phoneNumber
    ?.replace(/\D/g, "")
    ?.startsWith("91")
    ? newCampaigner.phoneNumber?.replace(/\D/g, "")
    : `91${newCampaigner.phoneNumber?.replace(/\D/g, "")}`;

  if (newCampaigner.status === "active") {
    const params = [
      { type: "text", text: newCampaigner.name },
      {
        type: "text",
        text: `https://campaigns.harekrishnavizag.org/${newCampaigner.slug}`,
      },
    ];
    try {
      await sendWhatsappMessage(
        campaignerPhoneNumber,
        "campaigner_onboarding_info",
        params,
      );
    } catch (error) {
      console.error("Whatsapp failed:", err.message);
    }
  }

  return {
    status: 201,
    message:
      req?.campaignerStatus === "active"
        ? "Campaigner created successfully"
        : "Campaigner registration pending admin approval",
    newCampaigner,
  };
};

export const getCampaignerService = async (req) => {
  const campId = req.params.campaignId;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 12;
  const skip = (page - 1) * pageSize;
  const status = req.query.status;
  const campStatus = req.query.campStatus;
  const search = req.query.search;
  const sort = req.query.sort;
  let sortOptions = { raisedAmount: -1, _id: -1 };
  const role = req?.user?.role;
  const userId = req?.user?.id;

  if (!campId) {
    throw new AppError("CampaignId is required", 400);
  }

  if (!mongoose.isValidObjectId(campId)) {
    throw new AppError(`Invalid campaginId: ${campId}`, 400);
  }

  const campaign = await Campaign.findOne({
    _id: campId,
    status: campStatus,
  });

  if (!campaign) {
    throw new AppError(`Campaign not found`, 404);
  }
  const options = {
    campaignId: campId,
    status,
  };

  if (role === "devotee") {
    const devotee = await TempleDevote.findOne({ userId: userId }).select(
      "_id",
    );
    if (!devotee) {
      throw new AppError("devotee Not Found", 404);
    }

    options.templeDevoteInTouch = devotee._id;
  }

  if (search) {
    options.$or = [
      { name: { $regex: search, $options: "i" } },
      { phoneNumber: { $regex: search } },
    ];
  }

  if (sort === "raised_asc") {
    sortOptions = { raisedAmount: 1, _id: 1 };
  } else if (sort === "raised_desc") {
    sortOptions = { raisedAmount: -1, _id: -1 };
  } else if (sort === "target_asc") {
    sortOptions = { targetAmount: 1, _id: 1 };
  } else if (sort === "target_desc") {
    sortOptions = { targetAmount: -1, _id: -1 };
  } else if (sort === "createdAt_asc") {
    sortOptions = { createdAt: 1, _id: 1 };
  } else if (sort === "createdAt_desc") {
    sortOptions = { createdAt: -1, _id: -1 };
  }

  const campaigners = await Campaigner.find(options)
    .populate("templeDevoteInTouch", "-createdAt -updatedAt")
    .populate("campaignId", "-createdAt -updatedAt")
    .sort(sortOptions)
    .skip(skip)
    .limit(pageSize)
    .select("-createdAt -updatedAt");
  const campaignersWithDonors = await Promise.all(
    campaigners.map(async (item) => {
      const donorsData =
        (
          await Donation.aggregate([
            {
              $match: {
                campaign: new mongoose.Types.ObjectId(campId),
                campaigner: item._id,
                status: "success",
              },
            },
            { $sort: { amount: -1 } },
            {
              $group: {
                _id: "$campaigner",
                funderCount: { $sum: 1 },
                topDonors: {
                  $push: {
                    name: "$donorName",
                    amount: "$amount",
                    isAnonymous: "$isAnonymous",
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                funderCount: 1,
                topDonors: { $slice: ["$topDonors", 3] },
              },
            },
          ])
        )[0] || {};

      return {
        ...item.toObject(),
        funderCount: donorsData.funderCount ?? 0,
        topDonors: donorsData.topDonors ?? [],
      };
    }),
  );

  const totalCampaigners = await Campaigner.countDocuments(options);

  const totalPages = Math.ceil(totalCampaigners / pageSize);

  return {
    status: 200,
    message: "Fetched campaigners successfully.",
    campaigners: campaignersWithDonors,
    count: totalCampaigners,
    totalPages,
  };
};

export const getSingleCampaignerService = async (req) => {
  const { slugId } = req.params;

  if (!slugId) {
    throw new AppError("campaignerId is required", 400);
  }
  let filter = { slug: slugId };

  if (mongoose.isValidObjectId(slugId)) {
    filter = {
      $or: [{ slug: slugId }, { _id: slugId }],
    };
  }

  const campaigner = await Campaigner.findOne(filter)
    .populate("templeDevoteInTouch", "-createdAt -updatedAt")
    .populate("campaignId", "-createdAt -updatedAt");

  if (!campaigner) {
    throw new AppError("Campaigner not found", 404);
  }

  const donationCount = await Donation.countDocuments({
    campaigner: campaigner._id,
    status: "success",
  });

  return {
    status: 200,
    message: "Campaigner details fetched",
    campaginerWithImage: campaigner,
    count: donationCount,
  };
};

export const getTopDonorsService = async (req) => {
  const { campaignId } = req.params;

  if (!campaignId) {
    throw new AppError("CampaignId is required", 400);
  }

  if (!mongoose.isValidObjectId(campaignId)) {
    throw new AppError(`Invalid campaginId: ${campaignId}`, 400);
  }

  const campaign = await Campaign.findOne({
    _id: campaignId,
    status: "active",
  });

  if (!campaign) {
    throw new AppError("Campaign not found", 404);
  }

  const topDonors = await Donation.find({
    campaign: campaignId,
    status: "success",
  })
    .sort({ amount: -1 })
    .limit(5)
    .select("donorName donorPhone donorEmail amount createdAt isAnonymous");

  if (!topDonors.length) {
    return {
      status: 200,
      message: "fetched successfully",
      topDonors,
    };
  }

  return {
    status: 200,
    message: `top ${topDonors.length} donars fetched successfully`,
    topDonors,
  };
};

export const getLastestDonorofCampaignerService = async (req) => {
  const { campaignId, slug } = req.params;

  if (!campaignId) {
    throw new AppError(`CampaginId is required`, 400);
  }

  if (!slug) {
    throw new AppError(`Slug is required`, 400);
  }

  if (!mongoose.isValidObjectId(campaignId)) {
    throw new AppError(`Invalid CampaignId: ${campaignId}`, 400);
  }

  const campaign = await Campaign.findOne({
    _id: campaignId,
    status: "active",
  });

  if (!campaign) {
    throw new AppError("Campaign not found", 404);
  }

  const campaigner = await Campaigner.findOne({
    slug: slug,
    campaignId,
  });

  if (!campaigner) {
    throw new AppError("Campaigner not found", 400);
  }

  const donations = await Donation.find({
    campaign: campaignId,
    campaigner: campaigner._id,
    status: "success",
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .select("donorName donorPhone donorEmail amount createdAt isAnonymous");

  return {
    status: 200,
    message: `Fetched latest ${donations.length} donors`,
    donations,
  };
};

export const updateCampaignerService = async (req) => {
  const id = req.params.id;

  if (!id) {
    throw new AppError("CampaignerId is required", 400);
  }

  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(`Invalid Id: ${id}`, 400);
  }
  const campaigner = await Campaigner.findById(id);

  if (!campaigner) {
    throw new AppError("Campaigner not found", 404);
  }

  const previousStatus = campaigner.status;

  const updateData = Object.fromEntries(
    Object.entries(req.body).filter(([_, value]) => value !== undefined),
  );
  delete updateData.raisedAmount;
  delete updateData.campaignId;
  if (updateData.name) {
    const slug = slugify(updateData.name, {
      lower: true,
      strict: true,
      trim: true,
    });

    const existingSlug = await Campaigner.exists({
      slug,
      _id: { $ne: id },
    });

    if (existingSlug) {
      throw new AppError("Campaigner with this name already exists", 400);
    }

    updateData.slug = slug;
  }

  if (Object.keys(updateData).length === 0) {
    throw new AppError("No fields provided for update", 400);
  }

  const updatedCampaigner = await Campaigner.findByIdAndUpdate(
    id,
    { $set: updateData },
    {
      returnDocument: "after",
      runValidators: true,
    },
  );

  if (previousStatus !== "active" && updateData.status === "active") {
    const phone = updatedCampaigner.phoneNumber.replace(/\D/g, "");
    const campaignerPhoneNumber = phone.startsWith("91") ? phone : `91${phone}`;

    const params = [
      { type: "text", text: updatedCampaigner.name },
      {
        type: "text",
        text: `https://campaigns.harekrishnavizag.org/${updatedCampaigner.slug}`,
      },
    ];

    try {
      await sendWhatsappMessage(
        campaignerPhoneNumber,
        "campaigner_registration_link_success",
        params,
      );
    } catch (error) {
      console.error("WhatsApp sending failed:", error.message);
    }
  }
  return {
    status: 200,
    message: "Updated successfully",
    data: updatedCampaigner,
  };
};

export const deleteCampaignerService = async (req) => {
  const id = req.params.id;

  if (!id) {
    throw new AppError("CampaignerId is required", 400);
  }

  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(`Invalid Id: ${id}`, 400);
  }

  const campaigner = await Campaigner.findById(id);

  if (!campaigner) {
    throw new AppError(`Campaigner not found`, 404);
  }

  if (campaigner.raisedAmount > 0) {
    throw new AppError(
      "Campaigner cannot be deleted after receiving donations",
      400,
    );
  }

  await campaigner.deleteOne();

  return {
    status: 200,
    message: "campaigner deleted successfully",
    data: campaigner,
  };
};
