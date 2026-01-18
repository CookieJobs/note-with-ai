/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/routes/notes.ts
import express from 'express';
import { Note } from '../models/Note';
import { summarizeNote, summarizeNoteMeta, summarizeNoteSummary, checkOrUpdateSummaryConcepts } from '../services/deepseek';
import { generateQwenEmbedding } from '../utils/embedding';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler, ErrorHandler, ResponseHandler } from '../utils/errorHandler';
import { UserValidator, ResourceValidator } from '../utils/userValidation';
import { DeepSeekApiClient } from '../utils/apiClient';

const router = express.Router();

function normalizeForEmbedding(text: string) {
  return String(text || '').trim();
}

function scheduleEmbeddingUpdate(params: {
  noteId: string;
  userId: string;
  updatedAt: Date;
  text: string;
}) {
  const { noteId, userId, updatedAt, text } = params;
  const baseText = normalizeForEmbedding(text);
  if (!baseText) return;

  // 不阻塞请求；失败/跳过都不影响主流程
  void (async () => {
    try {
      const embedding = await generateQwenEmbedding(baseText);
      if (!Array.isArray(embedding) || embedding.length === 0) return;

      // 防止“生成过程中内容又被改了”导致写入旧 embedding
      await Note.updateOne(
        { _id: noteId, userId, updatedAt },
        { $set: { embedding } }
      );
    } catch (e) {
      console.warn('⚠️ embedding 异步生成失败（已忽略）:', e);
    }
  })();
}

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
    summary: '',
    concepts: [],
    keywords: [],
    userId: user._id,
  });
  const savedNote = await note.save();

  // 自动生成 embedding（异步，不阻塞创建）
  scheduleEmbeddingUpdate({
    noteId: savedNote._id.toString(),
    userId: user._id.toString(),
    updatedAt: (savedNote as any).updatedAt,
    text: (savedNote as any).contentText || savedNote.content || '',
  });

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

  // 重要：这里不要用 note.save()，否则在“正文刚更新/AI 异步更新”等并发场景下容易触发 VersionError
  // 用原子更新写入 embedding，避免版本冲突
  const baseText = (note as any).contentText || note.content || '';
  const embedding = await generateQwenEmbedding(baseText);

  // 进一步：避免“生成 embedding 期间正文又被修改”，导致写入旧内容的 embedding
  // 只有当 updatedAt 未变化（仍是我们刚读到的版本）才写入；否则跳过，等待下一次保存再触发 embed
  const result = await Note.updateOne(
    { _id: id, userId: user._id, updatedAt: (note as any).updatedAt },
    { $set: { embedding } }
  );
  if (!result || (result as any).matchedCount === 0) {
    ResponseHandler.success(res, { skipped: true }, '笔记已更新，跳过写入旧 embedding');
    return;
  }

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

// 当前用户 embedding 统计（避免用全局 /api/embedding/stats 泄露他人数据）
router.get('/embedding/stats', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const user = await UserValidator.authenticateUser(req);

  const totalNotes = await Note.countDocuments({ userId: user._id });
  const notesWithEmbedding = await Note.countDocuments({
    userId: user._id,
    embedding: { $exists: true, $ne: null, $not: { $size: 0 } },
  });
  const notesWithoutEmbedding = totalNotes - notesWithEmbedding;
  const coverage = totalNotes > 0 ? Math.round((notesWithEmbedding / totalNotes) * 100) : 0;

  ResponseHandler.success(res, {
    totalNotes,
    notesWithEmbedding,
    notesWithoutEmbedding,
    coverage,
    timestamp: new Date().toISOString(),
  });
}));

// 当前用户 embedding 补齐（小批量、可重复调用）
router.post('/embedding/ensure', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const user = await UserValidator.authenticateUser(req);
  const limit = Math.max(1, Math.min(50, Number(req.body?.limit ?? 20)));

  const pending = await Note.find({
    userId: user._id,
    $or: [{ embedding: { $exists: false } }, { embedding: { $size: 0 } }, { embedding: null }],
  })
    .select('_id title content contentText updatedAt')
    .limit(limit);

  if (pending.length === 0) {
    ResponseHandler.success(res, { processed: 0, success: 0 }, '没有需要补齐 embedding 的笔记');
    return;
  }

  // 先把这些笔记的 embedding 清空（避免旧数据误判为已完成）
  // 注意：这里不强制清空已有 embedding（query 已筛掉），只是兜底保持一致
  const texts = pending.map((n: any) => `${String(n.title || '').trim()} ${String(n.contentText || n.content || '').trim()}`.trim());

  // 逐条生成（更稳）；后续需要再优化成 batch 再做
  let success = 0;
  for (let i = 0; i < pending.length; i++) {
    const note = pending[i] as any;
    const embedding = await generateQwenEmbedding(texts[i]);
    if (!Array.isArray(embedding) || embedding.length === 0) continue;
    const r = await Note.updateOne(
      { _id: note._id, userId: user._id, updatedAt: note.updatedAt },
      { $set: { embedding } }
    );
    if (r && (r as any).matchedCount > 0) success++;
  }

  ResponseHandler.success(res, { processed: pending.length, success }, 'embedding 补齐完成');
}));

// 当前用户 summary 补齐（小批量、可重复调用）
router.post('/summary/ensure', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const user = await UserValidator.authenticateUser(req);
  const limit = Math.max(1, Math.min(50, Number(req.body?.limit ?? 20)));

  const pending = await Note.find({
    userId: user._id,
    $or: [{ summary: { $exists: false } }, { summary: null }, { summary: '' }],
  })
    .select('_id content contentText updatedAt')
    .limit(limit);

  if (pending.length === 0) {
    ResponseHandler.success(res, { processed: 0, success: 0 }, '没有需要补齐 summary 的笔记');
    return;
  }

  let success = 0;
  for (let i = 0; i < pending.length; i++) {
    const note = pending[i] as any;
    const baseText = String(note.contentText || note.content || '').trim();
    if (!baseText) continue;
    const summary = await summarizeNoteSummary(baseText);
    if (!summary) continue;
    const r = await Note.updateOne(
      { _id: note._id, userId: user._id, updatedAt: note.updatedAt },
      { $set: { summary } }
    );
    if (r && (r as any).matchedCount > 0) success++;
  }

  ResponseHandler.success(res, { processed: pending.length, success }, 'summary 补齐完成');
}));

// 单条笔记 summary 重生成（调试/手动触发）
router.post('/:id/summary', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { id } = req.params;
  const user = await UserValidator.authenticateUser(req);
  const note = await ResourceValidator.validateOwnership(Note, id, user._id.toString(), '笔记');
  const baseText = String((note as any).contentText || (note as any).content || '').trim();
  if (!baseText) throw ErrorHandler.createValidationError('内容不能为空');
  const summary = await summarizeNoteSummary(baseText);
  await Note.updateOne({ _id: id, userId: user._id }, { $set: { summary } });
  ResponseHandler.success(res, { summary }, 'summary 生成成功');
}));

// 局部更新笔记（正文/标题/关键词），支持乐观并发控制
router.patch('/:id', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const { id } = req.params;
  const { title, content, contentJson, contentText, keywords, updatedAt, autoSummarize, summaryCheck } = req.body || {};
  const user = await UserValidator.authenticateUser(req);
  console.log('收到笔记局部更新请求，ID:', id, 'payload:', { title, content, contentText, keywords, updatedAt, autoSummarize, summaryCheck });

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
  if (summaryCheck !== undefined && typeof summaryCheck !== 'boolean') {
    throw ErrorHandler.createValidationError('summaryCheck 必须是 boolean');
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

  // 正文变更：先清空旧 embedding，避免“内容变了但向量还是旧的”
  if (contentChanged) {
    (note as any).embedding = [];
    // 正文变更：联想缓存失效（避免占用空间/避免返回过期结果）
    (note as any).recommendCache = null;
  }

  // 保存时：按需校验并更新 summary/concepts（不改标题/关键词）
  // 前端策略：仅当“长度变化>30%”时传 summaryCheck=true，否则不触发 LLM
  if (summaryCheck === true && contentChanged) {
    try {
      const oldSummary = String((note as any).summary || '').trim();
      const oldConcepts = Array.isArray((note as any).concepts) ? (note as any).concepts : [];
      const baseText = String(note.contentText || note.content || '').trim();
      const check = await checkOrUpdateSummaryConcepts({ text: baseText, oldSummary, oldConcepts });

      // 重新获取最新的 note，避免版本冲突 (VersionError)
      const freshNote = await Note.findById(id);
      
      // 二次乐观锁检查：确保在 AI 处理期间没有其他并发修改
      // 如果 updatedAt 变了，说明有新修改，我们不能覆盖
      if (freshNote) {
        const freshUpdatedTime = new Date(freshNote.updatedAt).getTime();
        const originalUpdatedTime = new Date(note.updatedAt).getTime();
        
        // 注意：这里我们比较的是 note.updatedAt（请求开始时的版本），
        // 如果 freshNote.updatedAt 比它新，说明中间被插队了。
        // 对于 summaryCheck（用户保存），这应该视为冲突。
        if (freshUpdatedTime !== originalUpdatedTime) {
            console.warn(`summaryCheck 期间发生并发修改，放弃覆盖。ID: ${id}`);
            // 抛出 409，让前端重试或处理
            res.status(409).json({ success: false, error: '笔记已在他处更新（AI处理期间）', data: { note: freshNote } });
            return;
        }

        // 重新应用用户提交的变更到 freshNote
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

        // 正文变更：清空旧 embedding（后续异步重算）
        (freshNote as any).embedding = [];
        (freshNote as any).recommendCache = null;

        // 仅当不合格时才更新 summary/concepts
        if (check && check.is_ok === false) {
          if (typeof check.summary === 'string') (freshNote as any).summary = check.summary;
          if (Array.isArray(check.concepts)) (freshNote as any).concepts = check.concepts;
        }

        await freshNote.save();

        scheduleEmbeddingUpdate({
          noteId: freshNote._id.toString(),
          userId: user._id.toString(),
          updatedAt: (freshNote as any).updatedAt,
          text: (freshNote as any).contentText || freshNote.content || '',
        });

        ResponseHandler.success(res, { note: freshNote }, '笔记更新成功');
        return;
      }
    } catch (e) {
      console.warn('summaryCheck 失败，忽略：', e);
      // 失败不阻塞保存，走普通保存流程
    }
  }

  // 可选：自动摘要与关键词重生成（基于正文变更，或者显式 autoSummarize 请求）
  // 注意：如果是新建笔记后的 autoSummarize 请求，contentChanged 可能为 false（为了不传大报文），
  // 但我们需要基于 DB 里的内容生成摘要。
  if (autoSummarize === true) {
    try {
      // 这里的 summarizeNoteMeta 比较耗时，这期间 note 可能已经被其他请求（如 embed）更新
      const summary = await summarizeNoteMeta(note.content);
      
      // 重新获取最新的 note，避免版本冲突 (VersionError)
      const freshNote = await Note.findById(id);
      if (freshNote) {
        // 二次乐观锁检查：确保在 AI 处理期间没有其他并发修改
        const freshUpdatedTime = new Date(freshNote.updatedAt).getTime();
        const originalUpdatedTime = new Date(note.updatedAt).getTime();
        
        // 对于后台 autoSummarize，如果发现并发修改，直接放弃本次更新即可（保留用户的新内容）
        if (freshUpdatedTime !== originalUpdatedTime) {
            console.warn(`autoSummarize 期间发生并发修改，放弃更新元数据。ID: ${id}`);
            // 这里不报错，直接返回当前最新 note，让前端同步状态
            ResponseHandler.success(res, { note: freshNote }, '检测到并发修改，跳过自动摘要更新');
            return;
        }

        // 使用最新的 note 对象来保存
        if (summary?.title) freshNote.title = summary.title;
        if (Array.isArray(summary?.keywords)) freshNote.keywords = summary.keywords;
        if (typeof summary?.summary === 'string') freshNote.summary = summary.summary;
        
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

        // 正文变更：清空旧 embedding（后续异步重算）
        (freshNote as any).embedding = [];
        (freshNote as any).recommendCache = null;
        
        // 如果 AI 生成了标题且用户没有显式提交标题，则使用 AI 的
        if (summary?.title && title === undefined) freshNote.title = summary.title;
        // 如果 AI 生成了关键词且用户没有显式提交关键词，则使用 AI 的
        if (Array.isArray(summary?.keywords) && keywords === undefined) freshNote.keywords = summary.keywords;
        // summary 始终由 AI 生成（用户不编辑），直接覆盖
        if (typeof summary?.summary === 'string') freshNote.summary = summary.summary;

        await freshNote.save();

        scheduleEmbeddingUpdate({
          noteId: freshNote._id.toString(),
          userId: user._id.toString(),
          updatedAt: (freshNote as any).updatedAt,
          text: (freshNote as any).contentText || freshNote.content || '',
        });
        
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

  if (contentChanged) {
    scheduleEmbeddingUpdate({
      noteId: note._id.toString(),
      userId: user._id.toString(),
      updatedAt: (note as any).updatedAt,
      text: (note as any).contentText || note.content || '',
    });
  }

  ResponseHandler.success(res, { note }, '笔记更新成功');
}));

export default router;
