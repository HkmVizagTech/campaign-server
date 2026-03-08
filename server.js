import dotenv from "dotenv";
import { connectToDB } from "./config/DBConnection.js";
import app from "./app.js";
dotenv.config();

const port = process.env.PORT || 8080;

connectToDB()
  .then(() => {
    app.listen(port, () => {
      console.log(`Port is connected to ${port}`);
    });
  })
  .catch((error) => {
    console.log(`DB connection failed: ${error}`);
    process.exit(1);
  });
