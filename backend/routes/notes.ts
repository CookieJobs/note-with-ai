// backend/routes/notes.ts
import express from 'express';
import { Note } from '../models/Note';
import { summarizeNote, generateEmbedding } from '../services/deepseek';

const router = express.Router();

router.get('/test', (req, res) => {
  res.json({ message: 'notes 路由已挂载' });
});

// 获取所有笔记，按创建时间倒序排列
router.get('/', async (req, res) => {
  try {
    const notes = await Note.find().sort({ createdAt: -1 });
    res.status(200).json({ notes }); // ✅ 修改点
  } catch (err: any) {
    res.status(500).json({ error: '获取笔记失败', detail: err.message || err });
  }
});

// 添加笔记
router.post('/', async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: '内容不能为空，且必须是字符串类型' });
  }

  try {
    // Step 1: 调用 AI 生成标题和关键词
    console.log('🌟 调用 AI 生成标题和关键词...');
    const { title, keywords } = await summarizeNote(content);
    console.log('✅ AI 返回标题和关键词：', title, keywords);

    // Step 2: 存入数据库（embedding 之后再异步生成）
    console.log('🌟 保存到数据库中...');
    const note = new Note({ content, title, keywords });
    const savedNote = await note.save();
    console.log('✅ 保存成功：', savedNote);

    res.status(201).json(savedNote);
  } catch (err: any) {
    console.error('❌ 保存失败：', err.message || err);
    res.status(500).json({ error: '保存笔记失败', detail: err.message || err });
  }
});

// 删除笔记
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await Note.findByIdAndDelete(id);
    if (!result) return res.status(404).json({ error: '笔记不存在' });
    res.status(200).json({ message: '笔记删除成功' });
  } catch (err: any) {
    console.error('❌ 删除笔记失败：', err.message || err);
    res.status(500).json({ error: '删除笔记失败', detail: err.message || err });
  }
});


// 异步生成 embedding 接口
router.post('/:id/embed', async (req, res) => {
  const { id } = req.params;

  try {
    const note = await Note.findById(id);
    if (!note) return res.status(404).json({ error: '未找到该笔记' });

    console.log('🌟 生成 embedding 中...');
    const embedding = await generateEmbedding(note.content);
    note.embedding = embedding;
    await note.save();
    console.log('✅ embedding 保存成功');

    res.status(200).json({ message: 'embedding 生成成功', embedding });
  } catch (err: any) {
    console.error('❌ embedding 生成失败：', err.message || err);
    res.status(500).json({ error: 'embedding 生成失败', detail: err.message || err });
  }
});

// 聊天接口
router.post('/chat', async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '消息内容无效' });
  }

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.7,
        stream: false
      })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'AI 没有返回结果';

    res.status(200).json({ reply });
  } catch (err: any) {
    console.error('❌ 聊天接口调用失败：', err.message || err);
    res.status(500).json({ error: 'AI 回复失败', detail: err.message || err });
  }
});

export default router;
