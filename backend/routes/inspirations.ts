/*
Input: 已登录用户的手动灵感研究请求
Output: 当前用户生成的最新研究灵感
Pos: 后端 HTTP 路由
Note: 路由只负责鉴权与标准响应适配；研究上下文、搜索和持久化由 inspirationService 负责
*/
import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { inspirationService } from '../services/inspirationService';
import { asyncHandler, ResponseHandler } from '../utils/errorHandler';
import { UserValidator } from '../utils/userValidation';

const router = express.Router();

router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  const user = await UserValidator.authenticateUser(req);
  const result = await inspirationService.request(user._id.toString());
  ResponseHandler.success(
    res,
    result,
    result.status === 'created' ? '研究灵感已生成' : '这次没有找到新灵感',
  );
}));

router.get('/latest', authenticateToken, asyncHandler(async (req, res) => {
  const user = await UserValidator.authenticateUser(req);
  ResponseHandler.success(
    res,
    { item: await inspirationService.latest(user._id.toString()) },
    '获取最新灵感成功',
  );
}));

export default router;
