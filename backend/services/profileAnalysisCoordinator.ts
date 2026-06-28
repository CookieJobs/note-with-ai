import UserProfile from '../models/UserProfile';
import { userAnalysisService } from './userAnalysisService';
import { logger } from '../utils/logger';

export type ProfileStatusForClient = 'analyzing' | 'ready' | 'failed';

type RequestAnalysisOptions = {
  source: 'auto' | 'manual';
  force?: boolean;
};

type LeanUserProfile = {
  userId: unknown;
  interests?: Array<{ topic: string; score: number }>;
  expertise?: Array<{ area: string; level: string }>;
  goals?: Array<{ description: string; timeframe: string; status: string }>;
  preferences?: {
    communicationStyle?: string;
    contentFocus?: string[];
    feedbackMode?: string;
  };
  summary?: string;
  theme?: {
    themeName?: string;
    cssType?: string;
    cssValue?: string;
    reasoning?: string;
  };
  analysisStatus?: 'idle' | 'queued' | 'running' | 'ready' | 'failed';
  analysisVersion?: number;
  analysisRequestedAt?: Date | null;
  analysisStartedAt?: Date | null;
  analysisError?: string;
  lastAnalyzedAt?: Date | null;
};

export class ProfileAnalysisCoordinator {
  private readonly activeJobs = new Map<string, Promise<void>>();

  private hasRenderableProfile(profile?: LeanUserProfile | null): boolean {
    if (!profile) return false;

    return Boolean(
      (Array.isArray(profile.interests) && profile.interests.length > 0) ||
      (Array.isArray(profile.expertise) && profile.expertise.length > 0) ||
      (typeof profile.summary === 'string' && profile.summary.trim().length > 0) ||
      (profile.theme && typeof profile.theme.cssValue === 'string' && profile.theme.cssValue.trim().length > 0)
    );
  }

  getClientStatus(profile?: LeanUserProfile | null): ProfileStatusForClient {
    if (!profile) return 'analyzing';
    if (profile.analysisStatus === 'failed') return 'failed';
    if (profile.analysisStatus === 'queued' || profile.analysisStatus === 'running') return 'analyzing';
    return 'ready';
  }

  async getProfile(userId: string): Promise<LeanUserProfile | null> {
    return UserProfile.findOne({ userId }).lean<LeanUserProfile | null>();
  }

  async requestAnalysis(userId: string, options: RequestAnalysisOptions): Promise<{
    profile: LeanUserProfile;
    accepted: boolean;
    status: ProfileStatusForClient;
  }> {
    const force = options.force === true;
    let profile = await this.getProfile(userId);

    if (!profile) {
      profile = await UserProfile.findOneAndUpdate(
        { userId },
        {
          $setOnInsert: {
            userId,
            analysisStatus: 'queued',
            analysisVersion: 1,
            analysisRequestedAt: new Date(),
            analysisStartedAt: null,
            analysisError: '',
            lastAnalyzedAt: null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean<LeanUserProfile>();
      this.startBackgroundJob(userId, profile.analysisVersion || 1);
      return { profile, accepted: true, status: this.getClientStatus(profile) };
    }

    if (profile.analysisStatus === 'queued' || profile.analysisStatus === 'running') {
      this.startBackgroundJob(userId, profile.analysisVersion || 0);
      return { profile, accepted: false, status: this.getClientStatus(profile) };
    }

    if (!force && this.hasRenderableProfile(profile)) {
      return { profile, accepted: false, status: this.getClientStatus(profile) };
    }

    const nextVersion = Math.max(Number(profile.analysisVersion || 0), 0) + 1;
    const updatedProfile = await UserProfile.findOneAndUpdate(
      { userId },
      {
        $set: {
          analysisStatus: 'queued',
          analysisVersion: nextVersion,
          analysisRequestedAt: new Date(),
          analysisStartedAt: null,
          analysisError: '',
        },
      },
      { new: true }
    ).lean<LeanUserProfile>();

    this.startBackgroundJob(userId, nextVersion);
    return {
      profile: updatedProfile || {
        ...profile,
        analysisStatus: 'queued',
        analysisVersion: nextVersion,
        analysisRequestedAt: new Date(),
        analysisStartedAt: null,
        analysisError: '',
      },
      accepted: true,
      status: 'analyzing',
    };
  }

  private startBackgroundJob(userId: string, analysisVersion: number): void {
    if (!analysisVersion) return;

    const activeKey = `${userId}:${analysisVersion}`;
    if (this.activeJobs.has(activeKey)) {
      return;
    }

    const job = this.runAnalysis(userId, analysisVersion)
      .catch((error) => {
        logger.error(`Profile analysis job failed for user: ${userId}, version: ${analysisVersion}`, error);
      })
      .finally(() => {
        this.activeJobs.delete(activeKey);
      });

    this.activeJobs.set(activeKey, job);
  }

  private async runAnalysis(userId: string, analysisVersion: number): Promise<void> {
    const claimed = await UserProfile.findOneAndUpdate(
      {
        userId,
        analysisVersion,
        analysisStatus: { $in: ['queued', 'running'] },
      },
      {
        $set: {
          analysisStatus: 'running',
          analysisStartedAt: new Date(),
          analysisError: '',
        },
      },
      { new: true }
    ).lean<LeanUserProfile | null>();

    if (!claimed) {
      return;
    }

    try {
      await userAnalysisService.analyzeUserProfile({ userId, analysisVersion });
    } catch (error) {
      const message = error instanceof Error ? error.message : '画像分析失败';

      await UserProfile.updateOne(
        {
          userId,
          analysisVersion,
          analysisStatus: 'running',
        },
        {
          $set: {
            analysisStatus: 'failed',
            analysisError: message,
          },
        }
      );

      throw error;
    }
  }
}

export const profileAnalysisCoordinator = new ProfileAnalysisCoordinator();
