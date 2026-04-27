import { Request, Response } from 'express';
import UserProfile from '../models/UserProfile';
import { Note } from '../models/Note';
import { userAnalysisService } from '../services/userAnalysisService';
import { ResponseHandler } from '../utils/errorHandler';
import { logger } from '../utils/logger';

export const getFeed = async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  
  // 1. Get User Profile
  let profile = await UserProfile.findOne({ userId });

  // If profile doesn't exist, trigger analysis and return generic feed
  if (!profile) {
    // Trigger analysis in background
    userAnalysisService.analyzeUserProfile(userId).catch(err => 
      logger.error('Background profile analysis failed:', err)
    );
    
    // Return recent notes as fallback
    const recentNotes = await Note.find({ userId }).sort({ createdAt: -1 }).limit(5);
    ResponseHandler.success(res, {
      feed: recentNotes.map(note => ({
        type: 'recent',
        title: note.title,
        content: note.content.substring(0, 200),
        noteId: note._id,
        reason: '最近创建'
      })),
      profileStatus: 'analyzing'
    });
    return;
  }

  // 2. Generate Feed based on Interests
  // Sort interests by score
  const topInterests = profile.interests.sort((a: { score: number }, b: { score: number }) => b.score - a.score).slice(0, 3);
  
  let feedItems: Record<string, unknown>[] = [];

  // Strategy 1: "Rediscover" - Find old notes matching top interests
  for (const interest of topInterests) {
    // Simple text search for now
    // Note: This requires text index on Note model which exists
    const notes = await Note.find({
      userId,
      $text: { $search: interest.topic }
    })
    .limit(2)
    .lean();

    feedItems.push(...notes.map(note => ({
      type: 'rediscover',
      title: note.title,
      content: note.content.substring(0, 200),
      noteId: note._id,
      reason: `基于你对“${interest.topic}”的兴趣`
    })));
  }

  // Deduplicate
  const uniqueFeedItems = Array.from(new Map(feedItems.map(item => [String(item.noteId), item])).values());

  // Shuffle and slice
  const finalFeed = uniqueFeedItems.sort(() => 0.5 - Math.random()).slice(0, 5);

  ResponseHandler.success(res, {
    feed: finalFeed,
    userProfile: {
      interests: profile.interests,
      summary: profile.summary,
      expertise: profile.expertise,
      theme: profile.theme
    }
  });
};

export const triggerAnalysis = async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  await userAnalysisService.analyzeUserProfile(userId);
  ResponseHandler.success(res, null, 'Analysis triggered successfully');
};
