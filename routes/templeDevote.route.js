import express from "express";
import {
  createTempleDevote,
  deleteDevote,
  getTempleDevotes,
  singleDevotee,
  updateDevotee,
} from "../controllers/templeDevote.controller.js";
import { verifyToken } from "../middlewares/verifyToken.middleware.js";
import { onlyAdmin } from "../middlewares/onlyAdmin.middleware.js";

const devoteRouter = express.Router();

devoteRouter.post("/", verifyToken, onlyAdmin, createTempleDevote);
devoteRouter.get("/", getTempleDevotes);
devoteRouter.delete("/:id", verifyToken, onlyAdmin, deleteDevote);
devoteRouter.patch("/:id", verifyToken, onlyAdmin, updateDevotee);
devoteRouter.get("/:id", verifyToken, onlyAdmin, singleDevotee);

export default devoteRouter;
