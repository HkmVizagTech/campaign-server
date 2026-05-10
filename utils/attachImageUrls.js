import { getSignedImageUrl } from "./R2.js";

export const attachImageUrl = async (docs) => {
  return Promise.all(
    docs.map(async (doc) => {
      if (doc?.image?.filename) {
        doc.image = {
          url: await getSignedImageUrl(doc?.image?.filename),
        };
      }
      return doc;
    }),
  );
};
