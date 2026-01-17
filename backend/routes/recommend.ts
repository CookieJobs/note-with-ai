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
import { authenticateToken } from '../middleware/auth';
import { UserValidator, ResourceValidator } from '../utils/userValidation';
import { asyncHandler, ResponseHandler, ErrorHandler } from '../utils/errorHandler';
import { updateNoteRecommendations } from '../services/recommendService';

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

/**
 * 语义联想笔记（方案B：多路召回→去重→仅Top10进LLM→阈值输出）
 * POST /api/recommend/semantic-notes
 * body: { noteId, recallK?:30, finalK?:10, s1Threshold?:0.35, hardThreshold?:0.62 }
 */
router.post('/semantic-notes', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const user = await UserValidator.authenticateUser(req);
  const {
    noteId,
    recallK,
    finalK,
    s1Threshold,
    hardThreshold,
  } = req.body || {};

  if (!noteId || typeof noteId !== 'string') {
    throw ErrorHandler.createValidationError('noteId 不能为空');
  }

  // 验证资源所有权
  await ResourceValidator.validateOwnership(Note, noteId, user._id.toString(), '笔记');

  // 调用推荐服务
  const result = await updateNoteRecommendations(noteId, user._id.toString(), {
    recallK: recallK ? Number(recallK) : undefined,
    finalK: finalK ? Number(finalK) : undefined,
    s1Threshold: s1Threshold ? Number(s1Threshold) : undefined,
    hardThreshold: hardThreshold ? Number(hardThreshold) : undefined,
  });

  if (!result) {
    ResponseHandler.success(res, { recommendations: [], meta: { recall: 0, final: 0 } }, '无可用推荐结果');
    return;
  }

  ResponseHandler.success(res, result, '语义联想成功');
}));

export default router;
