import express from "express";
import cors from "cors";
const app = express();

app.use(express.json());
app.use(cors());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

import { errorHandler } from "./utils/handlers.js";

app.use(errorHandler);

export default app;
