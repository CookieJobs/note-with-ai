import { Request, Response } from 'express';
import UserProfile from '../models/UserProfile';
import { Note } from '../models/Note';
import { userAnalysisService } from '../services/userAnalysisService';

export const getFeed = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    
    // 1. Get User Profile
    let profile = await UserProfile.findOne({ userId });

    // If profile doesn't exist, trigger analysis and return generic feed
    if (!profile) {
      // Trigger analysis in background
      userAnalysisService.analyzeUserProfile(userId).catch(err => 
        console.error('Background profile analysis failed:', err)
      );
      
      // Return recent notes as fallback
      const recentNotes = await Note.find({ userId }).sort({ createdAt: -1 }).limit(5);
      res.json({
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
    const topInterests = profile.interests.sort((a, b) => b.score - a.score).slice(0, 3);
    
    let feedItems: any[] = [];

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

    res.json({
      feed: finalFeed,
      userProfile: {
        interests: profile.interests,
        summary: profile.summary
      }
    });

  } catch (error) {
    console.error('Error getting feed:', error);
    res.status(500).json({ error: 'Failed to get feed' });
  }
};

export const triggerAnalysis = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    await userAnalysisService.analyzeUserProfile(userId);
    res.json({ message: 'Analysis triggered successfully' });
  } catch (error) {
    console.error('Error triggering analysis:', error);
    res.status(500).json({ error: 'Failed to trigger analysis' });
  }
};
