// backend/routes/recommend.ts
import express from 'express';
import { Note } from '../models/Note';
import { searchArticlesByKeyword } from '../services/search';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    // 查询用户所有笔记，统计关键词频率
    const notes = await Note.find();
    const keywordCounts: Record<string, number> = {};

    for (const note of notes) {
      for (const keyword of note.keywords || []) {
        keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
      }
    }

    const topKeywords = Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([kw]) => kw);

    // 根据 topKeywords 调用爬虫/搜索服务
    const articles = await searchArticlesByKeyword(topKeywords);

    res.json({ keywords: topKeywords, articles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '推荐失败' });
  }
});

export default router;
