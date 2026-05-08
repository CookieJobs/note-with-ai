/*
Input: 推荐查询参数与当前登录用户
Output: 热门关键词推荐结果、语义联想笔记结果
Pos: 后端 模块
Note: 推荐路由仅负责鉴权、参数校验与 HTTP 响应适配，推荐主流程统一收敛到 recommendService
*/
// backend/routes/recommend.ts
import express, { Request, Response } from 'express';
import { Note } from '../models/Note';
import { searchArticlesByKeyword } from '../services/search';
import { updateNoteRecommendations } from '../services/recommendService';
import { authenticateToken } from '../middleware/auth';
import { UserValidator, ResourceValidator } from '../utils/userValidation';
import { asyncHandler, ResponseHandler, ErrorHandler } from '../utils/errorHandler';

const router = express.Router();

router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  // 获取当前用户，确保只查询自己的笔记
  const user = await UserValidator.authenticateUser(req);
  const notes = await Note.find({ userId: user._id });
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
router.post('/semantic-notes', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const user = await UserValidator.authenticateUser(req);
  const {
    noteId,
    recallK = 30,
    finalK = 10,
    s1Threshold = 0.50, // 收紧阈值
    hardThreshold = 0.75, // 收紧阈值
  } = req.body || {};

  if (!noteId || typeof noteId !== 'string') {
    throw ErrorHandler.createValidationError('noteId 不能为空');
  }

  await ResourceValidator.validateOwnership(Note, noteId, user._id.toString(), '笔记');

  const result = await updateNoteRecommendations(noteId, user._id.toString(), {
    recallK,
    finalK,
    s1Threshold,
    hardThreshold,
    writeMode: 'background',
  });

  if (result.recommendations.length === 0) {
    ResponseHandler.success(res, { recommendations: [], meta: { recall: 0, final: 0 } }, result.message || '无满足阈值的候选');
    return;
  }

  ResponseHandler.success(res, {
    recommendations: result.recommendations,
    meta: {
      ...result.meta,
      thresholds: { s1Threshold, hardThreshold },
    },
  }, '语义联想成功');
}));

export default router;
