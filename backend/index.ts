/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/index.ts

import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

import noteRoutes from './routes/notes';
import chatRoutes from './routes/chat';
import recommendRoutes from './routes/recommend';
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
// TipTap 图片以 base64 写入 contentJson 时，请求体会显著变大。
// 默认 json limit 很小，容易触发 "request entity too large"（413）。
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || '25mb' }));

// 添加请求日志中间件
app.use((req, res, next) => {
  console.log(`📝 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// ✅ 健康检查
app.get('/api/health', (_, res) => {
  // 这里的路由会覆盖 routes/health.ts 里的 /api/health，所以把诊断信息放在这里最直观
  const isDev = process.env.NODE_ENV !== 'production';
  const mongo = isDev
    ? {
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host,
        db: mongoose.connection.name,
        hasMongoUri: !!process.env.MONGODB_URI,
      }
    : undefined;
  res.json({
    status: 'ok',
    ...(mongo ? { mongo } : {}),
  });
});

// ✅ 路由挂载
app.use('/api/auth', authRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/recommend', recommendRoutes);
app.use('/api/cache', cacheRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api', healthRoutes);

// 全局错误处理中间件（必须在所有路由之后）
app.use(globalErrorHandler);

// ✅ 启动服务
const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) {
    return;
  }
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB 连接成功');
  } catch (err) {
    console.error('❌ MongoDB 连接失败:', err);
    throw err;
  }
};

// Vercel Serverless Handler
export default async (req: any, res: any) => {
  await connectDB();
  return app(req, res);
};

// Local Development Server
if (require.main === module) {
  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Backend running at http://localhost:${PORT}`);
    });
  });
}
