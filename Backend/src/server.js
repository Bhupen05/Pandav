import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import { getUserFromToken } from './middleware/auth.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { handleChatSocket } from './utils/presence.js';
import { SOCKET_AUDIENCE, originMatcher, rejectForeignOrigin, requireProxy } from './utils/session.js';
import { setIo } from './utils/realtime.js';
import { startScheduler } from './utils/scheduler.js';
import './jobs/index.js';
import v2Routes from './routes/v2Routes.js';

dotenv.config();

// Fail at startup instead of on the first login
for (const name of ['MONGODB_URI', 'JWT_SECRET']) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

// Browser origins allowed to call the API and open sockets. Set CLIENT_URL to
// the deployed frontend's origin (comma-separated for more than one; * patterns
// work for preview deployments, see originMatcher).
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://pandav.onrender.com',
  ...[process.env.CLIENT_URL, process.env.FRONTEND_URL]
    .filter(Boolean)
    .flatMap((value) => value.split(','))
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
];
const isAllowedOrigin = originMatcher(allowedOrigins);

if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_URL && !process.env.FRONTEND_URL) {
  console.warn('CLIENT_URL is not set: browsers on the deployed frontend will be blocked by CORS');
}
if (process.env.NODE_ENV === 'production' && !process.env.ORIGIN_SECRET) {
  console.warn('ORIGIN_SECRET is not set: rate limits will count every visitor behind the frontend proxy as one');
}

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, {
  cors: {
    origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)),
    methods: ['GET', 'POST']
  }
});
setIo(io);

const PORT = process.env.PORT || 5000;
const API_V2_PREFIX = process.env.API_V2_PREFIX || '/api/v2';

// Socket.io: only authenticated users can connect, and the room each socket
// joins comes from the verified ticket (POST /api/auth/socket-token), never
// from the client
io.use(async (socket, next) => {
  try {
    const { user, claims } = (await getUserFromToken(socket.handshake.auth?.token, SOCKET_AUDIENCE)) || {};
    if (!user) return next(new Error('Not authorized'));
    socket.data.userId = user._id.toString();
    socket.data.userName = user.name;
    // The session the ticket was issued to (see disconnectUserSockets)
    socket.data.sid = claims.sid;
    next();
  } catch {
    next(new Error('Not authorized'));
  }
});

// Each socket's room, who it is told is online (only the people its user may
// message) and typing indicators: see utils/presence.js
io.on('connection', handleChatSocket);

// Connect to MongoDB
connectDB();

// Make io accessible in controllers
app.set('io', io);

// Hosts like Render put one proxy in front of the app; without this every
// client shares the proxy's IP and rate limits apply to everyone at once
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors({
  origin: function (origin, callback) {
    // Requests without an Origin header (Postman, curl, server-to-server) aren't subject to CORS
    callback(null, !origin || isAllowedOrigin(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use('/api', requireProxy);
// Responses are per-user; never let the proxy's CDN or the browser cache them
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', rejectForeignOrigin(isAllowedOrigin));
// Bodies are at most 1 MB (the largest is a profile image, ~200 KB), except
// file uploads (POST .../attachments), which carry a file of up to 2 MB as base64
const jsonBody = express.json({ limit: '1mb' });
const uploadBody = express.json({ limit: '3mb' });
app.use((req, res, next) =>
  (req.method === 'POST' && /\/attachments\/?$/.test(req.path) ? uploadBody : jsonBody)(req, res, next));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(sanitizeInput);

// The whole API, health check included (${API_V2_PREFIX}/health). The old
// copies under /api and /api/v1 are gone.
app.use(API_V2_PREFIX, v2Routes);

// Error handling middleware (Express recognises it by its four parameters)
app.use((err, req, res, _next) => {
  // Body parsing errors (too large, malformed JSON) are the client's, with their own 4xx status
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      success: false,
      message: err.type === 'entity.too.large' ? 'Request is too large' : 'Invalid request body',
    });
  }

  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

startScheduler();

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`API: http://localhost:${PORT}${API_V2_PREFIX}`);
});


