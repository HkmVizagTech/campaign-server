import Razorpay from "razorpay";

const razorypay = new Razorpay({
  key_id: process.env.RAZORPAY_API_KEY,
  key_secret: process.env.RAZORPAY_SECERT_KEY,
});

export default razorypay;
