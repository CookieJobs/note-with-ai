/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/routes/recommend.ts
import express from 'express';
import { Note } from '../models/Note';
import { searchArticlesByKeyword } from '../services/search';
import { asyncHandler, ResponseHandler } from '../utils/errorHandler';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
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

  return ResponseHandler.success(res, { keywords: topKeywords, articles });
}));

export default router;
