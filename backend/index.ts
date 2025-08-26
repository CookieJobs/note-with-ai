// backend/index.ts

import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

import noteRoutes from './routes/notes';
import chatRoutes from './routes/chat';
import recommendRoutes from './routes/recommend';
import forMeRoutes from './routes/for-me';
import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import cacheRoutes from './routes/cache';
import performanceRoutes from './routes/performance';
import { globalErrorHandler } from './utils/errorHandler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';

app.use(cors());
app.use(express.json());

// 添加请求日志中间件
app.use((req, res, next) => {
  console.log(`📝 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// ✅ 健康检查
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok' });
});

// ✅ 路由挂载
app.use('/api/auth', authRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/recommend', recommendRoutes);
app.use('/api/for-me', forMeRoutes);
app.use('/api/cache', cacheRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api', healthRoutes);

// 全局错误处理中间件（必须在所有路由之后）
app.use(globalErrorHandler);

// ✅ 启动服务
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB 连接成功');
    app.listen(PORT, () => {
      console.log(`🚀 Backend running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB 连接失败:', err);
  });