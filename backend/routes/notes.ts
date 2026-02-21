/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/routes/notes.ts
import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';
import { noteController } from '../controllers/noteController';

const router = express.Router();

router.get('/test', (req, res) => {
  res.json({ message: 'notes 路由已挂载' });
});

// 获取当前用户的所有笔记，按创建时间倒序排列
router.get('/', authenticateToken, asyncHandler((req, res, next) => noteController.getNotes(req, res, next)));

// 添加笔记
router.post('/', authenticateToken, asyncHandler((req, res, next) => noteController.createNote(req, res, next)));

// 删除笔记
router.delete('/:id', authenticateToken, asyncHandler((req, res, next) => noteController.deleteNote(req, res, next)));

// 异步生成 embedding 接口
router.post('/:id/embed', authenticateToken, asyncHandler((req, res, next) => noteController.generateEmbedding(req, res, next)));

// 聊天接口
// 注意：必须在 POST /:id 之前定义，否则会被 /:id 捕获
router.post('/chat', authenticateToken, asyncHandler((req, res, next) => noteController.chat(req, res, next)));

// 更新笔记标题
router.post('/:id', authenticateToken, asyncHandler((req, res, next) => noteController.updateTitle(req, res, next)));

// 当前用户 embedding 统计
router.get('/embedding/stats', authenticateToken, asyncHandler((req, res, next) => noteController.getEmbeddingStats(req, res, next)));

// 当前用户 embedding 补齐
router.post('/embedding/ensure', authenticateToken, asyncHandler((req, res, next) => noteController.ensureEmbeddings(req, res, next)));

// 当前用户 summary 补齐
router.post('/summary/ensure', authenticateToken, asyncHandler((req, res, next) => noteController.ensureSummaries(req, res, next)));

// 单条笔记 summary 重生成
router.post('/:id/summary', authenticateToken, asyncHandler((req, res, next) => noteController.regenerateSummary(req, res, next)));

// 局部更新笔记（正文/标题/关键词），支持乐观并发控制
router.patch('/:id', authenticateToken, asyncHandler((req, res, next) => noteController.updateNote(req, res, next)));

export default router;
