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
import type { RecommendationResult } from '../services/recommendService';
import { runProductionNoteEnrichmentTask } from '../services/noteEnrichmentWorker';
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
 * body: { noteId, recallK?:30, finalK?:10, s1Threshold?:0.35, hardThreshold?:0.65 }
 */
router.post('/semantic-notes', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const user = await UserValidator.authenticateUser(req);
  const {
    noteId,
    recallK = 30,
    finalK = 10,
    s1Threshold = 0.35,
    hardThreshold = 0.65,
    writeMode = 'background',
  } = req.body || {};

  if (!noteId || typeof noteId !== 'string') {
    throw ErrorHandler.createValidationError('noteId 不能为空');
  }
  if (writeMode !== 'await' && writeMode !== 'background') {
    throw ErrorHandler.createValidationError('writeMode 仅支持 await 或 background');
  }

  await ResourceValidator.validateOwnership(Note, noteId, user._id.toString(), '笔记');

  const source = await Note.findOne({ _id: noteId, userId: user._id }).select('revision');
  if (!source) {
    throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
  }
  const sourceRevision = typeof source.revision === 'number' && source.revision > 0 ? source.revision : 1;
  let result: RecommendationResult | undefined;
  const status = await runProductionNoteEnrichmentTask({
    noteId,
    userId: user._id.toString(),
    sourceRevision,
    artifact: 'recommendations',
  }, {
    onRecommendationResult: (completed) => {
      result = completed;
    },
    recommendationOptions: { recallK, finalK, s1Threshold, hardThreshold },
  });

  if (!result) {
    const message = status === 'stale' ? '笔记已被更新，请重试' : '刷新相关推荐失败';
    throw ErrorHandler.createExternalApiError(message, 'recommendation');
  }

  if (result.recommendations.length === 0) {
    ResponseHandler.success(res, {
      recommendations: [],
      meta: result.meta,
    }, result.message || '无满足阈值的候选');
    return;
  }

  ResponseHandler.success(res, {
    recommendations: result.recommendations,
    meta: result.meta,
  }, '语义联想成功');
}));

export default router;
