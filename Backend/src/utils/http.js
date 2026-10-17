import mongoose from 'mongoose';

// For matching user input as plain text inside a $regex
export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Mongoose's built-in validator messages ('Path `{PATH}` is required.', ...)
// as patterns for the filled-in text. Any other message was written in a
// schema for users to read.
const BUILT_IN_MESSAGES = Object.values(mongoose.Error.messages)
  .flatMap((group) => (group && typeof group === 'object' ? Object.values(group) : [group]))
  .filter((template) => typeof template === 'string')
  .map((template) => new RegExp(`^${escapeRegex(template).replace(/\\\{[A-Z]+\\\}/g, '[\\s\\S]*')}$`));

// One field's problem: the schema's own message if it has one, otherwise just
// the field's name. Built-in messages can quote the submitted value.
const fieldProblem = (fieldError) => {
  const message = fieldError.properties?.message;
  const isCustom = typeof message === 'string' && !BUILT_IN_MESSAGES.some((pattern) => pattern.test(message));
  return isCustom ? message : `Invalid ${fieldError.path}`;
};

// Sends an error response: 400 for bad input, otherwise a 500 that hides
// internal error details in production
export const sendServerError = (res, error) => {
  // Malformed ids and similar bad input are the client's mistake, not a server error
  if (error.name === 'CastError') {
    return res.status(400).json({ success: false, message: `Invalid ${error.path}` });
  }
  // A unique field (an email, a team name) that is already taken
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0];
    return res.status(400).json({ success: false, message: field ? `That ${field} is already in use` : 'Already exists' });
  }
  // A value the schema refuses (wrong enum, too long, ...)
  if (error.name === 'ValidationError') {
    const problems = [...new Set(Object.values(error.errors).map(fieldProblem))];
    return res.status(400).json({ success: false, message: problems.join('; ') });
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
