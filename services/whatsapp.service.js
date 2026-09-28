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

// Ported from the proven FOLK / HKM site integration (same "otp" template).
// Authentication templates: Meta rewrites the copy-code button into a URL
// button at approval time, so the code must be supplied TWICE — body variable
// and button URL parameter. sub_type "copy_code" is rejected (#132018) and
// omitting the button is rejected (#131008).
// Flaxxa returns HTTP 200 even when Meta rejects the message — the ONLY
// reliable success signal is a non-null message_wamid.
export const sendOtpWhatsappMessage = async (phone, template, otp) => {
  const components = [
    { type: "body", parameters: [{ type: "text", text: String(otp) }] },
    {
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: String(otp) }],
    },
  ];

  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage",
    {
      token: process.env.FLAXXA_TOKEN,
      phone,
      template_name: template,
      template_language: "en",
      components,
    },
    { headers: { "Content-Type": "application/json" }, timeout: 15000 },
  );

  const wamid = response.data?.message_wamid || response.data?.wamid;
  if (!wamid) {
    console.error(
      `WhatsApp OTP rejected for ${phone}:`,
      JSON.stringify(response.data).slice(0, 300),
    );
    throw new Error("WhatsApp did not accept the OTP message");
  }

  console.log(`WhatsApp OTP sent to ${phone} (wamid ${wamid})`);
  return response.data;
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
