import axios from "axios";

export const dccApiService = async (
  donation,
  gatewayPaymentId = null,
  modeOfPayment = 3,
) => {
  if (!donation) {
    return {
      success: false,
      data: null,
      error: { message: "Donation payload is required" },
    };
  }

  const payload = {
    donorName: donation.donorName,
    donorPhone: donation.donorPhone,
    donorEmail: donation?.donorEmail || null,
    gender: null,
    address: {
      fullAddress: donation?.address?.fullAddress || null,
      state: donation?.address?.state || null,
      city: donation?.address?.city || null,
      pinCode: donation?.address?.pincode || null,
    },
    PAN: donation?.pan || null,
    amount: String(donation?.amount || 0),
    accountType: 4,
    sevaCategory: donation?.seva?.sevaCategoryId || 2,
    sevaSubCategory: donation?.seva?.sevaSubCategoryId || 3,
    sevaSubCategoryCode: donation?.seva?.sevaSubCode || "GDGD",
    modeOfPayment,
    gatewayPaymentId: gatewayPaymentId || donation?.gatewayPaymentId || null,
    transactionDate: donation.createdAt.toLocaleDateString("en-GB"),
    enrolledBy: donation?.campaigner?.templeDevoteInTouch?.devoteeID || null,
  };

  try {
    const headers = {
      "DCC-Api-Key": process.env.DCC_API_KEY,
      "Content-Type": "application/json",
    };

    const result = await axios.post(process.env.DCC_API, payload, {
      headers,
    });

    return {
      success: true,
      data: result?.data || null,
      error: null,
    };
  } catch (error) {
    const errorPayload = error.response?.data || { message: error.message };
    console.log("DCC api failed: ", errorPayload);

    return {
      success: false,
      data: null,
      error: errorPayload,
    };
  }
};
