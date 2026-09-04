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
import { runProductionNoteEnrichmentTask, type EnrichmentTaskStatus } from '../services/noteEnrichmentWorker';
import { authenticateToken } from '../middleware/auth';
import { UserValidator, ResourceValidator } from '../utils/userValidation';
import { asyncHandler, ResponseHandler, ErrorHandler } from '../utils/errorHandler';
import { requireSingleRouteParam } from '../utils/requestParams';
import { findRelationshipContext, submitRelationshipFeedback, type RelationshipFeedbackVerdict } from '../services/relationshipService';

const router = express.Router();

export function getRecommendationTaskResult(
  status: EnrichmentTaskStatus,
  result: RecommendationResult | undefined,
): RecommendationResult {
  if (status === 'stale') {
    throw ErrorHandler.createExternalApiError('笔记已被更新，请重试', 'recommendation');
  }
  if (!result) {
    throw ErrorHandler.createExternalApiError('刷新相关推荐失败', 'recommendation');
  }
  return result;
}

export function toPublicRecommendationResult(result: RecommendationResult) {
  return {
    sourceNoteId: result.sourceNoteId,
    sourceRevision: result.sourceRevision,
    status: result.status,
    relationships: result.relationships,
    generatedAt: result.generatedAt,
  };
}

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

  const userId = user._id.toString();
  // Use a lean projection here: hydrated Mongoose documents apply the schema
  // default (`revision: 1`) even when the persisted field is absent.
  const source = await Note.findOne({ _id: noteId, userId }).select('revision').lean();
  if (!source) {
    throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
  }
  const hasCanonicalRevision = typeof source.revision === 'number' && source.revision > 0;
  let sourceRevision = hasCanonicalRevision ? source.revision : 1;
  if (source.revision === undefined) {
    // Legacy Mongo notes predate the revision field. Normalize only the
    // missing-field case before entering the revision-CAS enrichment path;
    // otherwise the worker's `{ revision: 1 }` lookup cannot see the note.
    await Note.updateOne(
      { _id: noteId, userId, revision: { $exists: false } },
      { $set: { revision: 1 } },
      { timestamps: false },
    );
  }
  let result: RecommendationResult | undefined;
  let status: EnrichmentTaskStatus = 'stale';

  // Recommendation generation can span multiple external calls. If a user
  // write advances the revision while it is running, retry once against the
  // newly-read canonical revision; every attempt still uses the worker's
  // revision/user CAS guard and stale results are never written through.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = undefined;
    status = await runProductionNoteEnrichmentTask({
      noteId,
      userId,
      sourceRevision,
      artifact: 'recommendations',
    }, {
      onRecommendationResult: (completed) => {
        result = completed;
      },
      recommendationOptions: { recallK, finalK, s1Threshold, hardThreshold },
    });

    if (status !== 'stale' || attempt === 1) break;

    const latest = await Note.findOne({ _id: noteId, userId }).select('revision').lean();
    if (!latest) break;
    const latestRevision = typeof latest.revision === 'number' && latest.revision > 0 ? latest.revision : 1;
    if (latestRevision === sourceRevision) break;
    sourceRevision = latestRevision;
  }

  result = getRecommendationTaskResult(status, result);

  ResponseHandler.success(res, toPublicRecommendationResult(result), result.message || '语义联想成功');
}));

router.post('/relationships/:relationshipId/feedback', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const user = await UserValidator.authenticateUser(req);
  const relationshipId = requireSingleRouteParam(req.params.relationshipId, 'relationshipId');
  const body = req.body || {};
  const verdicts = new Set(['helpful', 'not_relevant', 'hide_pair']);
  if (!verdicts.has(body.verdict)) {
    throw ErrorHandler.createValidationError('关系反馈参数无效');
  }
  const numericFields = ['sourceRevision', 'candidateRevision'];
  if (typeof body.sourceNoteId !== 'string' || typeof body.candidateNoteId !== 'string' ||
    numericFields.some((key) => !Number.isInteger(body[key]) || body[key] < 1)) {
    throw ErrorHandler.createValidationError('关系反馈参数无效');
  }
  try {
    const feedback = await submitRelationshipFeedback({
      userId: user._id.toString(),
      relationshipId,
      sourceNoteId: body.sourceNoteId,
      candidateNoteId: body.candidateNoteId,
      sourceRevision: body.sourceRevision,
      candidateRevision: body.candidateRevision,
      verdict: body.verdict as RelationshipFeedbackVerdict,
    });
    const storedVerdict = feedback && !Array.isArray(feedback) && typeof feedback === 'object' && 'verdict' in feedback
      ? (feedback as { verdict?: unknown }).verdict
      : undefined;
    ResponseHandler.success(res, { relationshipId, verdict: storedVerdict || body.verdict });
  } catch (error) {
    if (error instanceof Error && error.message === '关系已更新，请刷新后重试') {
      throw ErrorHandler.createExternalApiError(error.message, 'relationship');
    }
    if (error instanceof Error && (error.message === '关系不存在或无权限' || error.message === '关系不存在')) {
      throw ErrorHandler.createAuthorizationError(error.message);
    }
    throw error;
  }
}));

router.get('/relationships/:relationshipId/context', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const user = await UserValidator.authenticateUser(req);
  const relationshipId = requireSingleRouteParam(req.params.relationshipId, 'relationshipId');
  const context = await findRelationshipContext(user._id.toString(), relationshipId);
  if (!context) throw ErrorHandler.createAuthorizationError('关系上下文不可用');
  ResponseHandler.success(res, context);
}));

export default router;
