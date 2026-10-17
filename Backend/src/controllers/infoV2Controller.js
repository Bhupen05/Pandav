export const health = (req, res) => {
  res.json({ status: 'OK', version: 'v2', message: 'Server is running', timestamp: new Date().toISOString() });
};
