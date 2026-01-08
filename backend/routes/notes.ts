/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
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

  // 兼容旧数据：历史记录可能没有 contentText（或为空字符串），前端富文本/展示需要一个可用的纯文本字段
  const safeNotes = notes.map((n: any) => {
    const obj = typeof n.toObject === 'function' ? n.toObject() : n;
    if (typeof obj.contentText !== 'string' || obj.contentText.trim().length === 0) {
      obj.contentText = obj.content || '';
    }
    return obj;
  });

  ResponseHandler.success(res, { notes: safeNotes }, '获取笔记成功');
}));

// 添加笔记
router.post('/', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { content, contentJson, contentText } = req.body || {};
  const plain = (typeof contentText === 'string' ? contentText : (typeof content === 'string' ? content : '')).trim();
  if (!plain) {
    throw ErrorHandler.createValidationError('内容不能为空');
  }
  if (contentJson !== undefined && (typeof contentJson !== 'object' || contentJson === null)) {
    throw ErrorHandler.createValidationError('contentJson 必须是对象类型');
  }
  const user = await UserValidator.authenticateUser(req);
  const firstLine = (plain || '').split('\n')[0].trim();
  const fallbackTitle = firstLine.length > 0 ? firstLine.slice(0, 100) : '';
  const note = new Note({
    // 兼容字段：content 仍保存纯文本（用于旧逻辑/兜底展示）
    content: plain,
    contentText: plain,
    contentJson: contentJson,
    title: fallbackTitle,
    keywords: [],
    userId: user._id,
  });
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
  const { title, content, contentJson, contentText, keywords, updatedAt, autoSummarize } = req.body || {};
  const user = await UserValidator.authenticateUser(req);
  console.log('收到笔记局部更新请求，ID:', id, 'payload:', { title, content, contentText, keywords, updatedAt, autoSummarize });

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
  if (contentText !== undefined && typeof contentText !== 'string') {
    throw ErrorHandler.createValidationError('contentText 必须是字符串类型');
  }
  if (contentJson !== undefined && typeof contentJson !== 'object') {
    throw ErrorHandler.createValidationError('contentJson 必须是 JSON 对象');
  }
  if (keywords !== undefined) {
    if (!Array.isArray(keywords) || !keywords.every((k) => typeof k === 'string')) {
      throw ErrorHandler.createValidationError('关键词必须是字符串数组');
    }
  }

  // 应用更新
  let contentChanged = false;
  if (title !== undefined) note.title = title.trim();
  // contentText/contentJson（富文本）
  if (contentText !== undefined) {
    note.contentText = contentText;
    note.content = contentText; // 兼容旧逻辑：搜索/摘要/embedding 默认仍读 content
    contentChanged = true;
  } else if (content !== undefined) {
    note.content = content;
    note.contentText = content;
    note.contentJson = null;
    contentChanged = true;
  }
  if (contentJson !== undefined) {
    note.contentJson = contentJson;
  }
  if (keywords !== undefined) note.keywords = keywords;

  // 可选：自动摘要与关键词重生成（基于正文变更）
  if (autoSummarize === true && contentChanged) {
    try {
      // 这里的 summarizeNote 比较耗时，这期间 note 可能已经被其他请求（如 embed）更新
      const summary = await summarizeNote(note.content);
      
      // 重新获取最新的 note，避免版本冲突 (VersionError)
      const freshNote = await Note.findById(id);
      if (freshNote) {
        // 使用最新的 note 对象来保存
        if (summary?.title) freshNote.title = summary.title;
        if (Array.isArray(summary?.keywords)) freshNote.keywords = summary.keywords;
        
        // 确保我们也应用了刚才用户提交的变更（如果刚才的 save 成功了，这里其实已经有了，
        // 但为了保险起见，或者如果我们在上面没有先 save，这里应该合并）
        // 在当前的逻辑流中，我们上面还没有 save。
        // 所以我们需要把用户提交的变更也应用到 freshNote 上
        
        // 重新应用用户提交的变更到 freshNote (因为 freshNote 是从 DB 读的，可能还没包含本次请求的变更)
        if (title !== undefined) freshNote.title = title.trim();
        if (contentText !== undefined) {
          freshNote.contentText = contentText;
          freshNote.content = contentText;
        } else if (content !== undefined) {
          freshNote.content = content;
          freshNote.contentText = content;
          freshNote.contentJson = null;
        }
        if (contentJson !== undefined) {
          freshNote.contentJson = contentJson;
        }
        if (keywords !== undefined) freshNote.keywords = keywords;
        
        // 如果 AI 生成了标题且用户没有显式提交标题，则使用 AI 的
        if (summary?.title && title === undefined) freshNote.title = summary.title;
        // 如果 AI 生成了关键词且用户没有显式提交关键词，则使用 AI 的
        if (Array.isArray(summary?.keywords) && keywords === undefined) freshNote.keywords = summary.keywords;

        await freshNote.save();
        
        // 更新响应中的 note 对象，以便返回最新数据
        // 注意：这里我们替换了原本的 note 引用
        // 这是一个局部变量的重新赋值，不影响外面的逻辑，但为了响应一致性，我们手动构造返回数据
        ResponseHandler.success(res, { note: freshNote }, '笔记更新成功（含自动摘要）');
        return;
      }
    } catch (e) {
      console.warn('自动摘要失败，忽略：', e);
    }
  }

  await note.save();
  console.log('✅ 笔记局部更新成功');

  ResponseHandler.success(res, { note }, '笔记更新成功');
}));

export default router;
