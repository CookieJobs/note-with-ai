import { Request, Response } from 'express';
import UserProfile from '../models/UserProfile';
import { Note } from '../models/Note';
import { ResponseHandler } from '../utils/errorHandler';
import { profileAnalysisCoordinator } from '../services/profileAnalysisCoordinator';

type ProfileRecord = {
  interests?: unknown[];
  expertise?: unknown[];
  goals?: unknown[];
  preferences?: Record<string, unknown>;
  summary?: string;
  analysisStatus?: string;
  analysisError?: string;
  analysisFailedAt?: Date | null;
  lastAnalyzedAt?: Date | null;
  analysisInputNoteCount?: number | null;
  analysisInputScope?: string | null;
  profileInvalidatedAt?: Date | null;
};

function profileFields(profile: ProfileRecord | null) {
  if (!profile) return null;
  return {
    interests: profile.interests,
    expertise: profile.expertise,
    goals: profile.goals,
    preferences: profile.preferences,
    summary: profile.summary,
  };
}

function getStatus(profile: ProfileRecord | null): 'idle' | 'analyzing' | 'ready' | 'failed' {
  if (!profile) return 'idle';
  if (profile.analysisStatus === 'queued' || profile.analysisStatus === 'running') return 'analyzing';
  if (profile.analysisStatus === 'failed') return 'failed';
  if (profile.profileInvalidatedAt) return 'idle';
  const hasResult = Boolean(
    profile.summary?.trim() ||
    profile.expertise?.length ||
    profile.interests?.length
  );
  return hasResult ? 'ready' : 'idle';
}

export const getProfileAnalysis = async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const [noteCount, profile] = await Promise.all([
    Note.countDocuments({ userId }),
    UserProfile.findOne({ userId }).lean<ProfileRecord | null>(),
  ]);
  const insufficient = noteCount < 5;
  const historical = insufficient || Boolean(profile?.profileInvalidatedAt);
  const status = insufficient ? 'insufficient_data' : getStatus(profile);

  ResponseHandler.success(res, {
    userProfile: historical ? null : profileFields(profile),
    historicalProfile: historical ? profileFields(profile) : null,
    profileStatus: status,
    noteCount,
    analysisError: status === 'failed' ? '画像生成失败，请稍后重试' : '',
    analysisFailedAt: profile?.analysisFailedAt ? new Date(profile.analysisFailedAt).toISOString() : null,
    lastAnalyzedAt: profile?.lastAnalyzedAt ? new Date(profile.lastAnalyzedAt).toISOString() : null,
    analysisInputNoteCount: profile?.analysisInputNoteCount ?? null,
    analysisInputScope: profile?.analysisInputScope ?? null,
    profileInvalidatedAt: profile?.profileInvalidatedAt ? new Date(profile.profileInvalidatedAt).toISOString() : null,
  });
};

export const requestProfileAnalysis = async (req: Request, res: Response) => {
  const requested = await profileAnalysisCoordinator.requestAnalysis(req.user!.userId, {
    source: 'manual',
    force: true,
  });
  ResponseHandler.success(res, {
    accepted: requested.accepted,
    profileStatus: requested.status,
    reason: requested.reason,
    analysisError: requested.status === 'failed' ? '画像生成失败，请稍后重试' : '',
  });
};

export const getProfileTopics = async (req: Request, res: Response) => {
  res.status(410).json({ success: false, error: '笔记话题功能已退役', message: '笔记话题功能已退役', type: 'VALIDATION_ERROR', code: 'NOTE_TAGS_RETIRED' });
};

export const retryProfileTopics = async (req: Request, res: Response) => {
  res.status(410).json({ success: false, error: '笔记话题功能已退役', message: '笔记话题功能已退役', type: 'VALIDATION_ERROR', code: 'NOTE_TAGS_RETIRED' });
};
