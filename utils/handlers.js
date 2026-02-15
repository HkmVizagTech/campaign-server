import { AppError } from "./AppError.js";
import { response } from "./response.js";

export const asyncHandlers = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const errorHandler = (err, req, res, next) => {
  console.log("Error: ", err);

  if (err instanceof AppError) {
    return response(res, err.statusCode, err.message);
  }

  if (err.code === 11000) {
    return response(res, 400, "Duplicate Value");
  }

  return response(res, 500, "Internal Server Error");
};
