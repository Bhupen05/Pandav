// Sends a 500 response, hiding internal error details in production
export const sendServerError = (res, error) => {
  console.error(error);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Server error' : error.message,
  });
};

// Copies only the allowed keys that are present in source, so request bodies
// can't set fields the route doesn't intend to change
export const pick = (source = {}, keys) =>
  keys.reduce((result, key) => {
    if (source[key] !== undefined) result[key] = source[key];
    return result;
  }, {});
