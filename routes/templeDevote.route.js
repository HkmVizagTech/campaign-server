import express from 'express';
import { createTempleDevote } from '../controllers/templeDevote.controller.js';

const devoteRouter = express.Router();

devoteRouter.post("/",createTempleDevote);

export default devoteRouter;