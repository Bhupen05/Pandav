import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import authRoutes from './routes/authRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import userRoutes from './routes/userRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
import v2Routes from './routes/v2Routes.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;
const API_V1_PREFIX = process.env.API_V1_PREFIX || '/api/v1';
const API_V2_PREFIX = process.env.API_V2_PREFIX || '/api/v2';

// Socket.io
const activeUsers = new Map();

io.on('connection', (socket) => {
  socket.on('user_online', (userId) => {
    socket.join(userId); // join a room named after userId
    activeUsers.set(userId, socket.id);
    io.emit('update_active_users', Array.from(activeUsers.keys()));
  });

  socket.on('disconnect', () => {
    activeUsers.forEach((socketId, userId) => {
      if (socketId === socket.id) activeUsers.delete(userId);
    });
    io.emit('update_active_users', Array.from(activeUsers.keys()));
  });
});

// Connect to MongoDB
connectDB();

// Make io accessible in controllers
app.set('io', io);

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or Postman/Thunder Client)
    if (!origin) return callback(null, true);

    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
      'https://pandav.onrender.com',
      'https://pandav.onrender.com/',
      process.env.CLIENT_URL
    ].filter(Boolean);

    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('localhost')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins for now (change to false in production if needed)
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// V1 Routes (current production APIs)
app.use(`${API_V1_PREFIX}/auth`, authRoutes);
app.use(`${API_V1_PREFIX}/tasks`, taskRoutes);
app.use(`${API_V1_PREFIX}/attendance`, attendanceRoutes);
app.use(`${API_V1_PREFIX}/contact`, contactRoutes);
app.use(`${API_V1_PREFIX}/users`, userRoutes);
app.use(`${API_V1_PREFIX}/chat`, chatRoutes);
app.use(`${API_V1_PREFIX}/teams`, teamRoutes);
app.get(`${API_V1_PREFIX}/health`, (req, res) => {
  res.json({ status: 'OK', version: 'v1', message: 'Server is running' });
});

// Legacy alias to reduce breakage (can be removed later)
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/teams', teamRoutes);
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', version: 'v1', message: 'Server is running' });
});

// V2 Routes
app.use(API_V2_PREFIX, v2Routes);

// Error handling middleware
app.use((err, req, res, next) => {
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


