// Sends a 500 response, hiding internal error details in production
export const sendServerError = (res, error) => {
  // Malformed ids and similar bad input are the client's mistake, not a server error
  if (error.name === 'CastError') {
    return res.status(400).json({ success: false, message: `Invalid ${error.path}` });
  }
  // A value the schema refuses (wrong enum, too long, ...): name the fields, not the values
  if (error.name === 'ValidationError') {
    return res.status(400).json({ success: false, message: `Invalid ${Object.keys(error.errors).join(', ')}` });
  }

  console.error(error);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Server error' : error.message,
  });
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Response body for a list endpoint, with opt-in pagination (?page=2&limit=50).
// Without `page` every match is returned. `query` is the built find() for `filter`.
export const listResponse = async (model, filter, query, params = {}) => {
  if (params.page === undefined) {
    const data = await query;
    return { success: true, count: data.length, data };
  }

  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(params.limit, 10) || DEFAULT_PAGE_SIZE));
  const [data, total] = await Promise.all([
    query.skip((page - 1) * limit).limit(limit),
    model.countDocuments(filter),
  ]);
  return {
    success: true,
    count: data.length,
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

// Copies only the allowed keys that are present in source, so request bodies
// can't set fields the route doesn't intend to change
export const pick = (source = {}, keys) =>
  keys.reduce((result, key) => {
    if (source[key] !== undefined) result[key] = source[key];
    return result;
  }, {});

// For matching user input as plain text inside a $regex
export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
