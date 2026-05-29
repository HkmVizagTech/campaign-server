import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import Campaign from "../models/campaign.model.js";
import Media from "../models/media.model.js";
import Campaigner from "../models/campaigner.model.js";
import { uploadToR2, deleteFromR2, getSignedImageUrl } from "../utils/R2.js";
import TempleDevote from "../models/templeDevote.model.js";
import Donation from "../models/donation.model.js";
import slugify from "slugify";
import { sendWhatsappMessage } from "./whatsapp.service.js";

const sendWhatsappTemplate = async ({
  phoneNumber,
  templateId,
  params = [],
}) => {
  try {
    await sendWhatsappMessage(phoneNumber, templateId, params);
    return { success: true };
  } catch (error) {
    console.error(
      `WhatsApp send failed for template ${templateId}:`,
      error.message,
    );
    return { success: false, error: error.message };
  }
};

export const createCampaignerService = async (req) => {
  const {
    name,
    campaignId,
    targetAmount,
    imageId,
    phoneNumber,
    templeDevoteInTouch,
  } = req.body;

  const user = req.user;

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

    const uploadResult = await uploadToR2(req.file);

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
  const existingSlug = await Campaigner.findOne({ slug, campaignId });

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
    ...(Boolean(req?.isCampaigner) === false && {
      createdBy: user?.id,
      approvedBy: user?.id,
    }),
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

  const onboardingParams = [
    { type: "text", text: newCampaigner.name },
    {
      type: "text",
      text: `https://campaigns.harekrishnavizag.org/${newCampaigner.slug}`,
    },
  ];

  if (newCampaigner.status === "active") {
    await sendWhatsappTemplate({
      phoneNumber: campaignerPhoneNumber,
      templateId: "campaigner_onboarding_info",
      params: onboardingParams,
    });
  }

  if (newCampaigner.status === "pending") {
    await sendWhatsappTemplate({
      phoneNumber: templeDevote.phoneNumber,
      templateId: "campaigner_registration_notification",
    });
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
  const devoteeId = req.query.devoteeId;
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

  if (role !== "devotee" && devoteeId) {
    if (!mongoose.isValidObjectId(devoteeId)) {
      throw new AppError(`Invalid devoteeId: ${devoteeId}`, 400);
    }

    options.templeDevoteInTouch = devoteeId;
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
    .populate("createdBy", "name email role")
    .populate("approvedBy", "name email role")
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
  const { slugId, campaignId } = req.params;

  if (!slugId) {
    throw new AppError("campaignerId is required", 400);
  }

  if (!campaignId) {
    throw new AppError("CampaignId is required", 400);
  }

  if (!mongoose.isValidObjectId(campaignId)) {
    throw new AppError("Invalid campaignId", 400);
  }

  let filter = { slug: slugId, campaignId };

  if (mongoose.isValidObjectId(slugId)) {
    filter = {
      campaignId,
      $or: [{ slug: slugId }, { _id: slugId }],
    };
  }

  let campaigner = await Campaigner.findOne(filter)
    .populate("templeDevoteInTouch", "-createdAt -updatedAt")
    .populate("campaignId", "-createdAt -updatedAt")
    .populate("createdBy", "name email role")
    .populate("approvedBy", "name email role");

  // If not found by current slug, check if it's an old slug (name was changed)
  if (!campaigner) {
    const byOldSlug = await Campaigner.findOne({
      previousSlugs: slugId,
      campaignId,
    })
      .populate("templeDevoteInTouch", "-createdAt -updatedAt")
      .populate("campaignId", "-createdAt -updatedAt")
      .populate("createdBy", "name email role")
      .populate("approvedBy", "name email role");

    if (byOldSlug) {
      const donationCount = await Donation.countDocuments({
        campaigner: byOldSlug._id,
        status: "success",
      });
      return {
        status: 200,
        message: "Campaigner details fetched",
        campaginerWithImage: byOldSlug,
        count: donationCount,
        redirectTo: byOldSlug.slug, // Frontend uses this to update the URL
      };
    }
  }

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
  const user = req.user;

  if (!id) {
    throw new AppError("CampaignerId is required", 400);
  }

  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(`Invalid Id: ${id}`, 400);
  }

  const campaigner = await Campaigner.findById(id).populate(
    "templeDevoteInTouch",
    "userId",
  );

  if (!campaigner) {
    throw new AppError("Campaigner not found", 404);
  }

  // Devotees can only edit their own campaigner
  // Ownership is determined via templeDevoteInTouch.userId (always set, required field)
  if (user.role === "devotee") {
    const ownerId = campaigner.templeDevoteInTouch?.userId?.toString();
    if (!ownerId || ownerId !== user.id?.toString()) {
      throw new AppError(
        "You are not authorized to edit this campaigner",
        403,
      );
    }
  }

  const previousStatus = campaigner.status;

  // Get update data from req.body (text fields)
  const updateData = Object.fromEntries(
    Object.entries(req.body).filter(([_, value]) => value !== undefined),
  );

  // Remove fields that shouldn't be updated directly
  delete updateData.raisedAmount;
  delete updateData.campaignId;
  delete updateData.slug; // Will be regenerated if name changes
  delete updateData.templeDevoteInTouch; // Should never be changed via edit

  // Handle image update if a new file is uploaded
  if (req.file) {
    console.log("📸 New image uploaded for campaigner:", id);

    // Upload new image to R2
    const uploadResult = await uploadToR2(req.file);

    if (!uploadResult.filename || !uploadResult.url) {
      throw new AppError(`Image upload failed`, 500);
    }

    // Delete old image from R2 if exists
    if (campaigner.image && campaigner.image.filename) {
      try {
        await deleteFromR2(campaigner.image.filename);
        console.log("✅ Old image deleted from R2:", campaigner.image.filename);
      } catch (error) {
        console.error("Failed to delete old image from R2:", error.message);
        // Don't throw error - we still want to update with new image
      }
    }

    // Update with new image
    updateData.image = {
      filename: uploadResult.filename,
      url: uploadResult.url,
    };

    // Also create a media record
    await Media.create({
      name: campaigner.name,
      image: {
        filename: uploadResult.filename,
        url: uploadResult.url,
      },
    });

    console.log("✅ New image uploaded to R2 and media record created");
  }

  // Handle image removal (if client wants to delete the image)
  if (req.body.removeImage === "true") {
    console.log("🗑️ Removing image for campaigner:", id);

    // Delete image from R2 if exists
    if (campaigner.image && campaigner.image.filename) {
      try {
        await deleteFromR2(campaigner.image.filename);
        console.log("✅ Image deleted from R2");
      } catch (error) {
        console.error("Failed to delete image from R2:", error.message);
      }
    }

    // Remove image from campaigner
    updateData.image = null;
  }

  // Handle name change - update slug
  if (updateData.name && updateData.name !== campaigner.name) {
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

    // Store old slug so old URLs can redirect to the new one
    if (campaigner.slug && !campaigner.previousSlugs?.includes(campaigner.slug)) {
      updateData.previousSlugs = [
        ...(campaigner.previousSlugs || []),
        campaigner.slug,
      ];
    }

    updateData.slug = slug;
  }

  // Remove empty fields
  Object.keys(updateData).forEach((key) => {
    if (
      updateData[key] === undefined ||
      updateData[key] === null ||
      updateData[key] === ""
    ) {
      delete updateData[key];
    }
  });

  // Check if there's anything to update
  if (Object.keys(updateData).length === 0) {
    throw new AppError("No fields provided for update", 400);
  }

  // Handle status transition from pending to active
  const isPendingToActiveTransition =
    previousStatus === "pending" && updateData.status === "active";

  if (isPendingToActiveTransition) {
    updateData.approvedBy = user.id;
  }

  // Update the campaigner
  const updatedCampaigner = await Campaigner.findByIdAndUpdate(
    id,
    { $set: updateData },
    {
      returnDocument: "after",
      runValidators: true,
    },
  )
    .populate("templeDevoteInTouch", "-createdAt -updatedAt")
    .populate("campaignId", "-createdAt -updatedAt")
    .populate("createdBy", "name email role")
    .populate("approvedBy", "name email role");

  // Send WhatsApp notification if status changed to active
  if (isPendingToActiveTransition) {
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
      console.log("✅ WhatsApp notification sent");
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

  await deleteFromR2(campaigner.image.filename);
  await campaigner.deleteOne();

  return {
    status: 200,
    message: "campaigner deleted successfully",
    data: campaigner,
  };
};
