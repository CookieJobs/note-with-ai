import { authFetch } from '../utils/auth';

export interface FeedItem {
  type: 'recent' | 'rediscover';
  title: string;
  content: string;
  noteId: string;
  reason: string;
}

export interface Interest {
  topic: string;
  score: number;
}

export interface UserProfile {
  interests: Interest[];
  summary: string;
  expertise?: { area: string; level: string }[];
  goals?: { description: string; timeframe: string; status: string }[];
  theme?: {
    themeName: string;
    cssType: string;
    cssValue: string;
    reasoning: string;
  };
}

export interface FeedResponse {
  feed: FeedItem[];
  userProfile?: UserProfile;
  profileStatus?: 'analyzing' | 'ready';
}

export const getFeed = async (): Promise<FeedResponse> => {
  const response = await authFetch('/api/feed');
  if (!response.ok) {
    throw new Error('Failed to fetch feed');
  }
  const body = await response.json();
  return body.data;
};

export const triggerAnalysis = async (): Promise<void> => {
  const response = await authFetch('/api/feed/analyze', {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to trigger analysis');
  }
};

export interface UserStats {
  totalNotes: number;
  notesThisMonth: number;
  notesThisWeek: number;
  streakDays: number;
  maxStreak: number;
  totalWords: number;
  avgWordsPerNote: number;
  interestCount: number;
  lastAnalyzedAt: string | null;
}

export const getStats = async (): Promise<UserStats> => {
  const response = await authFetch('/api/user/stats');
  if (!response.ok) {
    throw new Error('Failed to fetch stats');
  }
  const body = await response.json();
  return body.data;
};
