/*
Input: 已登录用户的手动灵感研究请求
Output: 当前用户生成的最新研究灵感
Pos: 后端 HTTP 路由
Note: 路由只负责鉴权与标准响应适配；研究上下文、搜索和持久化由 inspirationService 负责
*/
import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { inspirationService } from '../services/inspirationService';
import { inspirationCatalogService, type InspirationView } from '../services/inspirationCatalogService';
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

router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await UserValidator.authenticateUser(req);
  ResponseHandler.success(res,
    { item: await inspirationCatalogService.detail(user._id.toString(), String(req.params.id)) },
    '获取灵感成功');
}));

export default router;
