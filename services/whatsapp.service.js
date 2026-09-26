import axios from "axios";
import FormData from "form-data";
import fs from "fs";

export const sendRecieptWhatsapp = async (
  phone,
  filePath,
  donorName,
  amount,
) => {
  try {
    const form = new FormData();
    const displayFilename = `Donation_Receipt_${donorName.replace(/\s+/g, "_")}.pdf`;
    form.append("token", process.env.FLAXXA_TOKEN);
    form.append("phone", phone);
    form.append("template_name", "campaigns_donation_success_reciept");
    form.append("template_language", "en");
    form.append(
      "components",
      JSON.stringify([
        {
          type: "body",
          parameters: [
            { type: "text", text: donorName },
            { type: "text", text: Number(amount || 0).toLocaleString("en-IN")},
          ],
        },
      ]),
    );

    form.append("header_attachment", fs.createReadStream(filePath), {
      filename: displayFilename,
      contentType: "application/pdf",
    });

    const response = await axios.post(
      "https://wapi.flaxxa.com/api/v1/sendtemplatemessage_withattachment",
      form,
      {
        headers: form.getHeaders(),
      },
    );

    console.log("WhatsApp sent:", response.data);

    return response.data;
  } catch (error) {
    console.error("WhatsApp Error:", error.response?.data || error.message);
  }
};

export const sendOtpWhatsappMessage = async (phone, template, otp) => {
  try {
    const form = new FormData();
    form.append("token", process.env.FLAXXA_TOKEN);
    form.append("phone", phone);
    form.append("template_name", template);
    form.append("template_language", "en");
    form.append(
      "components",
      JSON.stringify([
        {
          type: "body",
          parameters: [{ type: "text", text: otp }],
        },
        // Authentication templates with a Copy Code button REQUIRE the
        // same code to appear again here — Meta silently drops the
        // message (accepted by the BSP, but never actually dispatched,
        // wamid stays null) if this button component is missing.
        {
          type: "button",
          sub_type: "copy_code",
          index: "0",
          parameters: [{ type: "coupon_code", coupon_code: otp }],
        },
      ]),
    );

    const response = await axios.post(
      "https://wapi.flaxxa.com/api/v1/sendtemplatemessage_withattachment",
      form,
      {
        headers: form.getHeaders(),
      },
    );

    console.log("WhatsApp OTP sent:", response.data);

    return response.data;
  } catch (error) {
    console.error(
      "WhatsApp OTP Error:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const sendWhatsappMessage = async (phone,template, params = []) => {
  try {
    const form = new FormData();
    form.append("token", process.env.FLAXXA_TOKEN);
    form.append("phone", phone);
    form.append("template_name", template);
    form.append("template_language", "en");
    form.append(
      "components",
      JSON.stringify([
        {
          type: "body",
          parameters: params,
        },
      ]),
    );
    const response = await axios.post(
      "https://wapi.flaxxa.com/api/v1/sendtemplatemessage_withattachment",
      form,
      {
        headers: form.getHeaders(),
      },
    );

    console.log("WhatsApp sent:", response.data);

    return response.data;
  } catch (error) {
    console.error("WhatsApp Error:", error.response?.data || error.message);
  }
};
