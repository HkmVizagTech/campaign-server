import Media from "../models/media.model.js";

export const getMediaListService = async () => {
  const mediaList = await Media.find({})
    .sort({ name: 1 })
    .select("-createdAt -updatedAt");

  return {
    status: 200,
    message: "Media fetched successfully",
    mediaList,
  };
};
