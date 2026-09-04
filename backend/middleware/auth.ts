/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';
import User from '../models/User';

// 扩展Request接口，添加user属性
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticateToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: '访问令牌缺失' });
    return;
  }

  try {
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.userId).select('_id isActive').lean() as { isActive?: boolean } | null;
    if (!user || user.isActive === false) {
      res.status(401).json({ error: '登录已失效或账号已被禁用' });
      return;
    }
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: '无效的访问令牌' });
    return;
  }
};

// 可选的认证中间件（用于某些不强制登录的接口）
export const optionalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.userId).select('_id isActive').lean() as { isActive?: boolean } | null;
      if (user && user.isActive !== false) req.user = decoded;
    } catch (error) {
      // 忽略错误，继续执行
    }
  }
  
  next();
};
