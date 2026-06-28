import { Request, Response } from 'express';
import UserProfile from '../models/UserProfile';
import { Note } from '../models/Note';
import { ResponseHandler } from '../utils/errorHandler';
import { profileAnalysisCoordinator } from '../services/profileAnalysisCoordinator';

function getNotePreview(note: Record<string, unknown>) {
  const base = String(note.contentText || note.content || '');
  return base.substring(0, 200);
}

async function buildFallbackFeed(userId: string) {
  const recentNotes = await Note.find({ userId }).sort({ createdAt: -1 }).limit(5).lean();
  return recentNotes.map(note => ({
    type: 'recent' as const,
    title: note.title,
    content: getNotePreview(note),
    noteId: note._id,
    reason: '最近创建',
  }));
}

function hasProfileContent(profile: any) {
  if (!profile) return false;

  return Boolean(
    (Array.isArray(profile.interests) && profile.interests.length > 0) ||
    (Array.isArray(profile.expertise) && profile.expertise.length > 0) ||
    (typeof profile.summary === 'string' && profile.summary.trim().length > 0) ||
    (profile.theme && typeof profile.theme.cssValue === 'string' && profile.theme.cssValue.trim().length > 0)
  );
}

export const getFeed = async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;

  let profile: any = await UserProfile.findOne({ userId }).lean();
  if (!profile) {
    const requested = await profileAnalysisCoordinator.requestAnalysis(userId, {
      source: 'auto',
      force: false,
    });
    profile = requested.profile as any;
  }

  const profileStatus = profileAnalysisCoordinator.getClientStatus(profile as any);
  const fallbackFeed = await buildFallbackFeed(userId);

  if (profileStatus !== 'ready' || !hasProfileContent(profile)) {
    ResponseHandler.success(res, {
      feed: fallbackFeed,
      userProfile: profile ? {
        interests: profile.interests,
        summary: profile.summary,
        expertise: profile.expertise,
        goals: profile.goals,
        theme: profile.theme,
      } : undefined,
      profileStatus,
      analysisError: profile?.analysisError || '',
    });
    return;
  }

  const readyProfile = profile as NonNullable<typeof profile>;

  // 2. Generate Feed based on Interests
  // Sort interests by score
  const topInterests = [...(readyProfile.interests || [])]
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    .slice(0, 3);
  
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
      content: getNotePreview(note),
      noteId: note._id,
      reason: `基于你对“${interest.topic}”的兴趣`
    })));
  }

  // Deduplicate
  const uniqueFeedItems = Array.from(new Map(feedItems.map(item => [String(item.noteId), item])).values());

  // Shuffle and slice
  const finalFeed = uniqueFeedItems.sort(() => 0.5 - Math.random()).slice(0, 5);

  ResponseHandler.success(res, {
    feed: finalFeed.length > 0 ? finalFeed : fallbackFeed,
    userProfile: {
      interests: readyProfile.interests,
      summary: readyProfile.summary,
      expertise: readyProfile.expertise,
      goals: readyProfile.goals,
      theme: readyProfile.theme
    },
    profileStatus,
    analysisError: readyProfile.analysisError || '',
  });
};

export const triggerAnalysis = async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const requested = await profileAnalysisCoordinator.requestAnalysis(userId, {
    source: 'manual',
    force: true,
  });

  ResponseHandler.success(
    res,
    {
      profileStatus: requested.status,
      accepted: requested.accepted,
      analysisError: requested.profile.analysisError || '',
    },
    requested.accepted ? '画像分析已触发' : '画像分析已在进行中'
  );
};
