import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import { getUserFromToken } from './middleware/auth.js';
import { sanitizeInput } from './middleware/sanitize.js';
import authRoutes from './routes/authRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import userRoutes from './routes/userRoutes.js';
import chatRoutes from './routes/chatRoutes.js';

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

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});
const PORT = process.env.PORT || 5000;

// Socket.io: only authenticated users can connect, and the room each socket
// joins comes from the verified token, never from the client
io.use(async (socket, next) => {
  try {
    const user = await getUserFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('Not authorized'));
    socket.data.userId = user._id.toString();
    next();
  } catch (error) {
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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// Largest legitimate body is a profile image, capped at ~200 KB by the User model
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(sanitizeInput);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/users', userRoutes);

// Add chat routes
app.use('/api/chat', chatRoutes);

// Health check: 503 while the database is unreachable, so the host and
// uptime monitors see an instance that can't serve requests as down
app.get('/api/health', (req, res) => {
  const databaseUp = mongoose.connection.readyState === 1;
  res.status(databaseUp ? 200 : 503).json({
    status: databaseUp ? 'OK' : 'UNAVAILABLE',
    database: databaseUp ? 'connected' : 'disconnected',
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
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
  console.log(`Local: http://localhost:${PORT}`);
});
