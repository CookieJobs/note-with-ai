// backend/routes/notes.ts
import express from 'express';
import { Note } from '../models/Note';
import { summarizeNote, generateEmbedding } from '../services/deepseek';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler, ErrorHandler, ResponseHandler } from '../utils/errorHandler';
import { UserValidator, ResourceValidator } from '../utils/userValidation';
import { DeepSeekApiClient } from '../utils/apiClient';

const router = express.Router();

router.get('/test', (req, res) => {
  res.json({ message: 'notes 路由已挂载' });
});

// 获取当前用户的所有笔记，按创建时间倒序排列
router.get('/', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const user = await UserValidator.authenticateUser(req);
  
  const notes = await Note.find({ userId: user._id }).sort({ createdAt: -1 });
  ResponseHandler.success(res, { notes }, '获取笔记成功');
}));

// 添加笔记
router.post('/', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { content } = req.body;
  
  if (!content || typeof content !== 'string') {
    throw ErrorHandler.createValidationError('内容不能为空，且必须是字符串类型');
  }

  const user = await UserValidator.authenticateUser(req);

  // Step 1: 调用 AI 生成标题和关键词
  console.log('🌟 调用 AI 生成标题和关键词...');
  const { title, keywords } = await summarizeNote(content);
  console.log('✅ AI 返回标题和关键词：', title, keywords);

  // Step 2: 存入数据库
  console.log('🌟 保存到数据库中...');
  const note = new Note({ content, title, keywords, userId: user._id });
  const savedNote = await note.save();
  console.log('✅ 保存成功：', savedNote);

  ResponseHandler.success(res, savedNote, '笔记创建成功', 201);
}));

// 删除笔记
router.delete('/:id', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { id } = req.params;
  const user = await UserValidator.authenticateUser(req);

  // 验证资源所有权并删除
  await ResourceValidator.validateOwnership(Note, id, user._id.toString(), '笔记');
  
  const result = await Note.findByIdAndDelete(id);
  if (!result) {
    throw ErrorHandler.createNotFoundError('笔记删除失败');
  }
  
  ResponseHandler.success(res, null, '笔记删除成功');
}));

// 异步生成 embedding 接口
router.post('/:id/embed', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { id } = req.params;
  const user = await UserValidator.authenticateUser(req);

  // 验证资源所有权
  const note = await ResourceValidator.validateOwnership(Note, id, user._id.toString(), '笔记');

  const embedding = await generateEmbedding(note.content);
  note.embedding = embedding;
  await note.save();
  console.log('✅ embedding 保存成功');

  ResponseHandler.success(res, { embedding }, 'embedding 生成成功');
}));

// 聊天接口
router.post('/chat', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw ErrorHandler.createValidationError('消息内容无效');
  }

  await UserValidator.authenticateUser(req);

  const apiClient = new DeepSeekApiClient(process.env.DEEPSEEK_API_KEY!);
  const data = await apiClient.chatCompletion(messages, {
    temperature: 0.7,
    stream: false
  });

  const reply = data.choices?.[0]?.message?.content || 'AI 没有返回结果';

  ResponseHandler.success(res, { reply }, '聊天成功');
}));

export default router;
