// backend/routes/notes.ts
import express from 'express';
import { Note } from '../models/Note';
import { summarizeNote } from '../services/deepseek';
import { generateQwenEmbedding } from '../utils/embedding';
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
  const firstLine = (content || '').split('\n')[0].trim();
  const fallbackTitle = firstLine.length > 0 ? firstLine.slice(0, 100) : '';
  const note = new Note({ content, title: fallbackTitle, keywords: [], userId: user._id });
  const savedNote = await note.save();
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

  const embedding = await generateQwenEmbedding(note.content);
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

// 更新笔记标题
router.post('/:id', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { id } = req.params;
  const { title } = req.body;
  const user = await UserValidator.authenticateUser(req);
  console.log('收到更新标题请求，ID:', id, '新标题:', title);

  // 验证标题参数
  if (title === undefined || typeof title !== 'string') {
    throw ErrorHandler.createValidationError('标题必须是字符串类型');
  }

  // 验证资源所有权
  const note = await ResourceValidator.validateOwnership(Note, id, user._id.toString(), '笔记');

  // 更新标题
  note.title = title.trim();
  await note.save();
  console.log('✅ 笔记标题更新成功');

  ResponseHandler.success(res, { note }, '笔记标题更新成功');
}));

// 局部更新笔记（正文/标题/关键词），支持乐观并发控制
router.patch('/:id', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { id } = req.params;
  const { title, content, keywords, updatedAt, autoSummarize } = req.body || {};
  const user = await UserValidator.authenticateUser(req);
  console.log('收到笔记局部更新请求，ID:', id, 'payload:', { title, content, keywords, updatedAt, autoSummarize });

  // 验证资源所有权
  const note = await ResourceValidator.validateOwnership(Note, id, user._id.toString(), '笔记');

  // 乐观并发：如提交了 updatedAt，需与当前记录一致
  if (updatedAt) {
    const clientUpdatedAt = new Date(updatedAt).getTime();
    const currentUpdatedAt = new Date(note.updatedAt).getTime();
    if (isNaN(clientUpdatedAt)) {
      throw ErrorHandler.createValidationError('updatedAt 无效');
    }
    if (clientUpdatedAt !== currentUpdatedAt) {
      res.status(409).json({ success: false, error: '笔记已在他处更新', data: { note } });
      return;
    }
  }

  // 字段校验
  if (title !== undefined && typeof title !== 'string') {
    throw ErrorHandler.createValidationError('标题必须是字符串类型');
  }
  if (content !== undefined && typeof content !== 'string') {
    throw ErrorHandler.createValidationError('内容必须是字符串类型');
  }
  if (keywords !== undefined) {
    if (!Array.isArray(keywords) || !keywords.every((k) => typeof k === 'string')) {
      throw ErrorHandler.createValidationError('关键词必须是字符串数组');
    }
  }

  // 应用更新
  let contentChanged = false;
  if (title !== undefined) note.title = title.trim();
  if (content !== undefined) {
    note.content = content;
    contentChanged = true;
  }
  if (keywords !== undefined) note.keywords = keywords;

  // 可选：自动摘要与关键词重生成（基于正文变更）
  if (autoSummarize === true && contentChanged) {
    try {
      const summary = await summarizeNote(note.content);
      if (summary?.title) note.title = summary.title;
      if (Array.isArray(summary?.keywords)) note.keywords = summary.keywords;
    } catch (e) {
      console.warn('自动摘要失败，忽略：', e);
    }
  }

  await note.save();
  console.log('✅ 笔记局部更新成功');

  ResponseHandler.success(res, { note }, '笔记更新成功');
}));

export default router;
