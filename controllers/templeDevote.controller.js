import {
  createTempleDevoteService,
  deleteDevoteService,
  getTempleDevotesService,
  singleDevoteeService,
  updateDevoteeService,
} from "../services/templeDevote.service.js";
import { asyncHandlers } from "../utils/handlers.js";
import { response } from "../utils/response.js";

export const createTempleDevote = asyncHandlers(async (req, res) => {
  const { status, message, newDevote } = await createTempleDevoteService(req);

  response(res, status, message, newDevote);
});

export const getTempleDevotes = asyncHandlers(async (req, res) => {
  const { status, message, devotes } = await getTempleDevotesService(req);

  response(res, status, message, devotes);
});

export const deleteDevote = asyncHandlers(async (req, res) => {
  const { status, message, data } = await deleteDevoteService(req);
  response(res, status, message, data);
});

export const updateDevotee = asyncHandlers(async (req, res) => {
  const { status, message, data } = await updateDevoteeService(req);
  response(res, status, message, data);
});

export const singleDevotee = asyncHandlers(async (req, res) => {
  const { status, message, data } = await singleDevoteeService(req);
  response(res, status, message, data);
});
