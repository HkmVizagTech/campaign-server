export const response = (res, statusCode, message, data = null) => {
  if (!res) {
    return console.log("res is required");
  }

  const responseObj = {
    success: statusCode < 400,
    statusCode,
    message,
    ...(data ? { data } : {}),
  };

  return res.status(statusCode).json(responseObj);
};
