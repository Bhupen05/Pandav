import express from 'express';
import { health } from '../controllers/infoV2Controller.js';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import taskRoutes from './taskRoutes.js';
import attendanceRoutes from './attendanceRoutes.js';
import teamRoutes from './teamRoutes.js';
import chatRoutes from './chatRoutes.js';
import contactRoutes from './contactRoutes.js';
import socialRoutes from './socialV2Routes.js';

const router = express.Router();

// Health + version probe
router.get('/health', health);
router.get('/status', health);

// Core v2 modules (backward-compatible implementations)
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/tasks', taskRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/teams', teamRoutes);
router.use('/chat', chatRoutes);
router.use('/contact', contactRoutes);

// New v2 social/network module
router.use('/social', socialRoutes);

export default router;
