import dotenv from "dotenv";
import { connectToDB } from "./config/DBConnection.js";
import app from "./app.js";
import { startStaleDonationCleanupJob } from "./jobs/staleDonationCleanup.js";
dotenv.config();

const port = process.env.PORT || 8080;

connectToDB()
  .then(() => {
    app.listen(port, () => {
      console.log(`Port is connected to ${port}`);
    });
    startStaleDonationCleanupJob();
  })
  .catch((error) => {
    console.log(`DB connection failed: ${error}`);
    process.exit(1);
  });
