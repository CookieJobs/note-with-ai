import { Request, Response } from 'express';
import { userStatsService } from '../services/userStatsService';
import { ResponseHandler } from '../utils/errorHandler';

export const getStats = async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const stats = await userStatsService.getStats(userId);
  ResponseHandler.success(res, stats);
};
