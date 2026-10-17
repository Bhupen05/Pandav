import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import { getUserFromToken } from './middleware/auth.js';
import { canReceiveDirectMessages } from './controllers/chatController.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { SOCKET_AUDIENCE, rejectForeignOrigin, requireProxy } from './utils/session.js';
import authRoutes from './routes/authRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import userRoutes from './routes/userRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
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
// the deployed frontend's origin (comma-separated for more than one).
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
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;
const API_V1_PREFIX = process.env.API_V1_PREFIX || '/api/v1';
const API_V2_PREFIX = process.env.API_V2_PREFIX || '/api/v2';

// Socket.io: only authenticated users can connect, and the room each socket
// joins comes from the verified ticket (POST /api/auth/socket-token), never
// from the client
io.use(async (socket, next) => {
  try {
    const { user } = (await getUserFromToken(socket.handshake.auth?.token, SOCKET_AUDIENCE)) || {};
    if (!user) return next(new Error('Not authorized'));
    socket.data.userId = user._id.toString();
    socket.data.userName = user.name;
    next();
  } catch {
    next(new Error('Not authorized'));
  }
});

// userId -> number of open sockets, so closing one tab doesn't mark the user offline
const onlineUsers = new Map();
const broadcastOnlineUsers = () => {
  io.emit('update_active_users', Array.from(onlineUsers.keys()));
};

io.on('connection', (socket) => {
  const { userId } = socket.data;
  socket.join(userId);
  onlineUsers.set(userId, (onlineUsers.get(userId) || 0) + 1);
  broadcastOnlineUsers();

  // Typing indicators for direct chats. Who is typing comes from the verified
  // token; the client only says to whom, and only someone this user could
  // message (checked once per recipient) is told.
  const recipients = new Set();
  const relayTyping = async (recipientId, event, payload) => {
    if (typeof recipientId !== 'string' || recipientId === userId) return;
    if (!recipients.has(recipientId)) {
      if (!(await canReceiveDirectMessages(recipientId))) return;
      recipients.add(recipientId);
    }
    socket.to(recipientId).emit(event, payload);
  };
  // The payload is whatever the client sent (null, a number, ...): read it
  // defensively, because an exception in a socket handler stops the server
  socket.on('typing', (data) => {
    relayTyping(data?.recipientId, 'user_typing', { userId, userName: socket.data.userName }).catch(() => {});
  });
  socket.on('stopped_typing', (data) => {
    relayTyping(data?.recipientId, 'user_stopped_typing', { userId }).catch(() => {});
  });

  socket.on('disconnect', () => {
    const remaining = (onlineUsers.get(userId) || 1) - 1;
    if (remaining > 0) {
      onlineUsers.set(userId, remaining);
    } else {
      onlineUsers.delete(userId);
    }
    broadcastOnlineUsers();
  });
});

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
    callback(null, !origin || allowedOrigins.includes(origin));
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
app.use('/api', rejectForeignOrigin(allowedOrigins));
// Largest legitimate body is a profile image, capped at ~200 KB by the User model
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(sanitizeInput);

// Health check: 503 while the database is unreachable, so the host and
// uptime monitors see an instance that can't serve requests as down
const healthCheck = (req, res) => {
  const databaseUp = mongoose.connection.readyState === 1;
  res.status(databaseUp ? 200 : 503).json({
    status: databaseUp ? 'OK' : 'UNAVAILABLE',
    version: 'v1',
    database: databaseUp ? 'connected' : 'disconnected',
  });
};

// V1 Routes (current production APIs)
app.use(`${API_V1_PREFIX}/auth`, authRoutes);
app.use(`${API_V1_PREFIX}/tasks`, taskRoutes);
app.use(`${API_V1_PREFIX}/attendance`, attendanceRoutes);
app.use(`${API_V1_PREFIX}/contact`, contactRoutes);
app.use(`${API_V1_PREFIX}/users`, userRoutes);
app.use(`${API_V1_PREFIX}/chat`, chatRoutes);
app.use(`${API_V1_PREFIX}/teams`, teamRoutes);
app.get(`${API_V1_PREFIX}/health`, healthCheck);

// Legacy alias to reduce breakage (can be removed later)
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/teams', teamRoutes);
app.get('/api/health', healthCheck);

// V2 Routes
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

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Local v1: http://localhost:${PORT}${API_V1_PREFIX}`);
  console.log(`Local v2: http://localhost:${PORT}${API_V2_PREFIX}`);
});


