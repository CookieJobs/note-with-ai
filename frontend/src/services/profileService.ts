import { authFetch } from '../utils/auth';

export interface LegacyProfileDto {
  interests?: { topic: string; score: number }[];
  summary?: string;
  expertise?: { area: string; level: string }[];
  goals?: { description: string; timeframe: string; status: string }[];
  preferences?: Record<string, unknown>;
  theme?: {
    themeName: string;
    cssType: string;
    cssValue: string;
    reasoning: string;
  };
}

// Keep a descriptive alias for existing profile theme helpers during the migration.
export type UserProfile = LegacyProfileDto;

export interface ProfileAnalysisResponse {
  userProfile: LegacyProfileDto | null;
  historicalProfile: LegacyProfileDto | null;
  profileStatus: 'idle' | 'analyzing' | 'ready' | 'failed' | 'insufficient_data';
  noteCount: number;
  analysisError: string;
  lastAnalyzedAt: string | null;
  analysisInputNoteCount: number | null;
  analysisInputScope: 'recent_up_to_20' | 'unknown' | null;
}

export interface ProfileAnalysisTriggerResponse {
  accepted: boolean;
  profileStatus: ProfileAnalysisResponse['profileStatus'];
  reason?: string;
  analysisError: string;
}

export interface UserStats {
  totalNotes: number;
  notesThisMonth: number;
}

async function getData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init);
  if (!response.ok) throw new Error('Request failed');
  const body = await response.json();
  return body.data as T;
}

export const getProfileAnalysis = (): Promise<ProfileAnalysisResponse> =>
  getData('/api/profile/analysis');

export const triggerProfileAnalysis = (): Promise<ProfileAnalysisTriggerResponse> =>
  getData('/api/profile/analysis', { method: 'POST' });

export const getStats = (): Promise<UserStats> => getData('/api/user/stats');
