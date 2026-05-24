// backend/index.ts

import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

import noteRoutes from './routes/notes';
import chatRoutes from './routes/chat';
import chatRelatedNotesRoutes from './routes/chatRelatedNotes';
import recommendRoutes from './routes/recommend';
import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import cacheRoutes from './routes/cache';
import performanceRoutes from './routes/performance';
import feedRoutes from './routes/feedRoutes';
import userRoutes from './routes/userRoutes';
import { globalErrorHandler } from './utils/errorHandler';
import { logger } from './utils/logger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';

// CORS 限制：仅允许指定来源
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:3000', 'http://localhost:3001'];
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// 请求体大小限制（防止超大 payload 导致 OOM）
app.use(express.json({ limit: '5mb' }));

// 添加请求日志中间件
app.use((req, res, next) => {
  logger.info(`📝 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// ✅ 轻量存活探针
app.get('/api/ping', (_, res) => {
  res.status(200).json({ status: 'ok' });
});

// ✅ 路由挂载
app.use('/api/auth', authRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/chat', chatRelatedNotesRoutes);
app.use('/api/recommend', recommendRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/user', userRoutes);
app.use('/api/cache', cacheRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api', healthRoutes);

// 全局错误处理中间件（必须在所有路由之后）
app.use(globalErrorHandler);

// ✅ 启动服务
const connectDB = async () => {
  const g = globalThis as any;

  if (mongoose.connection.readyState >= 1) {
    return;
  }

  if (!g.__mongoConnectPromise) {
    g.__mongoConnectPromise = mongoose
      .connect(MONGODB_URI)
      .then(() => {
        logger.info('✅ MongoDB 连接成功');
      })
      .catch((err: unknown) => {
        g.__mongoConnectPromise = undefined;
        logger.error('❌ MongoDB 连接失败:', err);
        throw err;
      });
  }

  await g.__mongoConnectPromise;
};

// Vercel Serverless Handler
export default async (req: Request, res: Response) => {
  await connectDB();
  return app(req, res);
};

// Local Development Server
if (require.main === module) {
  connectDB().then(() => {
    app.listen(PORT, () => {
      logger.info(`🚀 Backend running at http://localhost:${PORT}`);
    });
  });
}
