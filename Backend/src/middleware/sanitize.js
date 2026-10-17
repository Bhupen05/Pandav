// Removes MongoDB operator keys ($ne, $gt, ...) and dotted paths from user
// input, so request data can't change the shape of a database query
const stripOperators = (value) => {
  if (Array.isArray(value)) return value.map(stripOperators);

  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete value[key];
      } else {
        value[key] = stripOperators(value[key]);
      }
    }
  }
  return value;
};

export const sanitizeInput = (req, res, next) => {
  stripOperators(req.body);
  stripOperators(req.query);
  stripOperators(req.params);
  next();
};
