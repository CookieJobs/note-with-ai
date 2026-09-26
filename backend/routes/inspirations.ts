/*
Input: 已登录用户的手动灵感研究请求
Output: 当前用户生成的最新研究灵感
Pos: 后端 HTTP 路由
Note: 路由只负责鉴权与标准响应适配；研究上下文、搜索和持久化由 inspirationService 负责
*/
import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { inspirationService } from '../services/inspirationService';
import { inspirationCatalogService, type InspirationView, type InspirationStateOperation } from '../services/inspirationCatalogService';
import { inspirationScheduleService } from '../services/inspirationScheduleService';
import { asyncHandler, ErrorHandler, ResponseHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';

const router = express.Router();

router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await UserValidator.authenticateUser(req);
  if ((req.query.view !== undefined && typeof req.query.view !== 'string')
    || (req.query.cursor !== undefined && typeof req.query.cursor !== 'string')) {
    throw ErrorHandler.createValidationError('无效的灵感翻页参数');
  }
  const view = typeof req.query.view === 'string' ? req.query.view : 'recent';
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  ResponseHandler.success(res,
    await inspirationCatalogService.list(user._id.toString(), view as InspirationView, cursor),
    '获取灵感历史成功');
}));

router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await UserValidator.authenticateUser(req);
  const result = await inspirationService.request(user._id.toString());
  ResponseHandler.success(
    res,
    result,
    result.status === 'created' ? '研究灵感已生成' : '这次没有找到新灵感',
  );
}));

router.get('/latest', authenticateToken, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await UserValidator.authenticateUser(req);
  ResponseHandler.success(
    res,
    { item: await inspirationService.latest(user._id.toString()) },
    '获取最新灵感成功',
  );
}));

router.get('/unviewed-count', authenticateToken, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await UserValidator.authenticateUser(req);
  ResponseHandler.success(res,
    { count: await inspirationCatalogService.unviewedCount(user._id.toString()) },
    '获取新灵感数量成功');
}));

router.get('/settings', authenticateToken, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await UserValidator.authenticateUser(req);
  ResponseHandler.success(res, await inspirationScheduleService.get(user._id.toString()), '获取灵感设置成功');
}));

router.put('/settings', authenticateToken, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await UserValidator.authenticateUser(req);
  if (typeof req.body?.enabled !== 'boolean' || Object.keys(req.body).length !== 1) {
    throw ErrorHandler.createValidationError('无效的灵感设置');
  }
  ResponseHandler.success(res,
    await inspirationScheduleService.setEnabled(user._id.toString(), req.body.enabled),
    '灵感设置已更新');
}));

router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await UserValidator.authenticateUser(req);
  ResponseHandler.success(res,
    { item: await inspirationCatalogService.detail(user._id.toString(), String(req.params.id)) },
    '获取灵感成功');
}));

router.patch('/:id/user-state', authenticateToken, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await UserValidator.authenticateUser(req);
  const operation = req.body?.operation;
  if (typeof operation !== 'string' || !['save', 'unsave', 'dismiss', 'restore'].includes(operation)) {
    throw ErrorHandler.createValidationError('无效的灵感操作');
  }
  ResponseHandler.success(res,
    { item: await inspirationCatalogService.changeUserState(user._id.toString(), String(req.params.id), operation as InspirationStateOperation) },
    '灵感状态已更新');
}));

router.post('/:id/viewed', authenticateToken, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await UserValidator.authenticateUser(req);
  ResponseHandler.success(res,
    { item: await inspirationCatalogService.markViewed(user._id.toString(), String(req.params.id)) },
    '灵感已查看');
}));

export default router;
