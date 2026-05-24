import { Request, Response } from 'express';
import { Note } from '../models/Note';
import UserProfile from '../models/UserProfile';
import { ResponseHandler } from '../utils/errorHandler';

export const getStats = async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;

  const [totalNotes, allNotes, profile] = await Promise.all([
    Note.countDocuments({ userId }),
    Note.find({ userId }).select('createdAt content').sort({ createdAt: -1 }).lean(),
    UserProfile.findOne({ userId }).select('interests lastAnalyzedAt').lean(),
  ]);

  // 本月新增
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const notesThisMonth = allNotes.filter(
    (n) => new Date(n.createdAt) >= monthStart
  ).length;

  // 连续记录天数（从昨天往回算）
  const dateSet = new Set(
    allNotes.map((n) => {
      const d = new Date(n.createdAt);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })
  );
  let streakDays = 0;
  const checkDate = new Date();
  checkDate.setDate(checkDate.getDate() - 1); // 从昨天开始检查
  while (true) {
    const key = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
    if (dateSet.has(key)) {
      streakDays++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // 总字数
  const totalWords = allNotes.reduce(
    (sum, n) => sum + (n.content || '').length,
    0
  );
  const avgWordsPerNote =
    totalNotes > 0 ? Math.round(totalWords / totalNotes) : 0;

  // 本周新增
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const notesThisWeek = allNotes.filter(
    (n) => new Date(n.createdAt) >= weekStart
  ).length;

  // 最长连续记录
  let maxStreak = 0;
  let currentStreak = 0;
  const sortedDates = [...dateSet].sort();
  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0) {
      currentStreak = 1;
    } else {
      const prev = new Date(sortedDates[i - 1]);
      const curr = new Date(sortedDates[i]);
      const diffDays =
        (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays === 1) {
        currentStreak++;
      } else {
        currentStreak = 1;
      }
    }
    maxStreak = Math.max(maxStreak, currentStreak);
  }

  ResponseHandler.success(res, {
    totalNotes,
    notesThisMonth,
    notesThisWeek,
    streakDays,
    maxStreak,
    totalWords,
    avgWordsPerNote,
    interestCount: profile?.interests?.length || 0,
    lastAnalyzedAt: profile?.lastAnalyzedAt || null,
  });
};
