import express from 'express';
import authRoutes from './auth';
import { adminNoStore } from '../../middleware/adminAuth';
const router = express.Router();
router.use(adminNoStore);
router.use('/auth', authRoutes);
export default router;
