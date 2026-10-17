import mongoose from 'mongoose';

// Health check: 503 while the database is unreachable, so the host and
// uptime monitors see an instance that can't serve requests as down
export const health = (req, res) => {
  const databaseUp = mongoose.connection.readyState === 1;
  res.status(databaseUp ? 200 : 503).json({
    status: databaseUp ? 'OK' : 'UNAVAILABLE',
    version: 'v2',
    database: databaseUp ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
};
