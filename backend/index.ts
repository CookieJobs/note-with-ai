// backend/index.ts

import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

import noteRoutes from './routes/notes';
import chatRoutes from './routes/chat';
import recommendRoutes from './routes/recommend';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';

app.use(cors());
app.use(express.json());

// ✅ 健康检查
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok' });
});

// ✅ 路由挂载
app.use('/api/notes', noteRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/recommend', recommendRoutes);

// ✅ 启动服务
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Backend running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB 连接失败:', err);
  });