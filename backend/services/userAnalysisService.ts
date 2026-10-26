import { Note } from '../models/Note';
import UserProfile from '../models/UserProfile';
import { DeepSeekApiClient } from '../utils/apiClient';
import { getDeepSeekClient } from './llmService';
import { logger } from '../utils/logger';

type AnalyzeUserProfileParams = {
  userId: string;
  analysisVersion: number;
};

export class UserAnalysisService {
  private getApiClient(): DeepSeekApiClient {
    return getDeepSeekClient();
  }

  private hasRenderableProfile(profile: Record<string, unknown>): boolean {
    return Boolean(
      (Array.isArray(profile.interests) && profile.interests.length > 0) ||
      (Array.isArray(profile.expertise) && profile.expertise.length > 0) ||
      (typeof profile.summary === 'string' && profile.summary.trim().length > 0)
    );
  }

  private async markAnalysisInsufficient(userId: string, analysisVersion: number): Promise<void> {
    await UserProfile.updateOne(
      { userId, analysisVersion, analysisStatus: 'running' },
      {
        $set: {
          analysisStatus: 'failed',
          analysisError: '笔记数量不足，未生成画像',
          analysisFailedAt: new Date(),
        },
      }
    );
  }

  private async commitProfileResult(
    userId: string,
    analysisVersion: number,
    profileData: Record<string, unknown>,
    inputNoteCount: number
  ): Promise<boolean> {
    const result = await UserProfile.updateOne(
      { userId, analysisVersion, analysisStatus: 'running' },
      {
        $set: {
          ...profileData,
          analysisStatus: 'ready',
          analysisError: '',
          analysisFailedAt: null,
          lastAnalyzedAt: new Date(),
          analysisInputNoteCount: inputNoteCount,
          analysisInputScope: 'recent_up_to_20',
        },
        $unset: { profileInvalidatedAt: 1 },
      }
    );

    return result.matchedCount > 0;
  }

  /**
   * Analyze user's recent notes and chat history to update their profile.
   * This should be called by a background job or cron task.
   */
  async analyzeUserProfile({ userId, analysisVersion }: AnalyzeUserProfileParams): Promise<{ committed: boolean; reason: string }> {
    try {
      logger.info(`Starting user profile analysis for user: ${userId}, version: ${analysisVersion}`);

      // 1. Check eligibility and fetch recent data (e.g., last 20 notes)
      // TODO: Also fetch recent chat history
      const initialNoteCount = await Note.countDocuments({ userId });
      if (initialNoteCount < 5) {
        await this.markAnalysisInsufficient(userId, analysisVersion);
        return { committed: false, reason: 'insufficient_data' };
      }
      const notes = await Note.find({ userId }).sort({ createdAt: -1 }).limit(20);
      
      if (notes.length < 5) {
        logger.info(`Not enough data to analyze for user: ${userId}`);
        await this.markAnalysisInsufficient(userId, analysisVersion);
        return { committed: false, reason: 'insufficient_data' };
      }

      const notesText = notes.map(n => 
        `[${n.createdAt.toISOString().split('T')[0]}] ${n.title || 'Untitled'}: ${n.content.substring(0, 500)}`
      ).join('\n---\n');

      // 2. Call LLM to extract the user profile
      const prompt = `
        You are a user profiling expert. Based on the following user notes, extract a structured user profile.
        
        CRITICAL INSTRUCTION: All output text (including topics, areas, descriptions, and summary) MUST be in Chinese (简体中文).
        
        Output strictly in JSON format with the following structure:
        {
          "interests": [{ "topic": string, "score": number (0.0-1.0) }],
          "expertise": [{ "area": string, "level": "Beginner" | "Intermediate" | "Advanced" | "Expert" }],
          "goals": [{ "description": string, "timeframe": "Short-term" | "Long-term", "status": "Active" }],
          "preferences": {
            "communicationStyle": string,
            "contentFocus": string[],
            "feedbackMode": "Gentle" | "Direct"
          },
          "summary": string (100-200 words biography)
        }
  
        Notes:
        ${notesText}
      `;

      const response = await this.getApiClient().chatCompletion([
        { role: 'system', content: 'You are a helpful assistant that outputs JSON. You MUST use Chinese (简体中文) for all text content.' },
        { role: 'user', content: prompt }
      ], {
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });

      // 3. Parse and Update DB
      const parsedProfile: unknown = JSON.parse(response);
      if (
        typeof parsedProfile !== 'object' ||
        parsedProfile === null ||
        Array.isArray(parsedProfile) ||
        !this.hasRenderableProfile(parsedProfile as Record<string, unknown>)
      ) {
        throw new Error('No usable profile data was generated');
      }
      const modelProfile = parsedProfile as Record<string, any>;
      // The model returns untrusted JSON. Commit only user-facing profile fields so it
      // cannot alter coordinator state or the durable historical invalidation marker.
      const profileData: Record<string, any> = {};
      for (const field of ['interests', 'expertise', 'goals', 'preferences', 'summary']) {
        if (Object.prototype.hasOwnProperty.call(modelProfile, field)) profileData[field] = modelProfile[field];
      }
      
      // Add timestamps
      if (profileData.interests) {
        profileData.interests.forEach((i: { lastUpdated: Date }) => i.lastUpdated = new Date());
      }
      if (profileData.goals) {
        profileData.goals.forEach((g: { createdAt: Date }) => g.createdAt = new Date());
      }
      delete profileData.userId;
      delete profileData.analysisStatus;
      delete profileData.analysisVersion;
      delete profileData.analysisRequestedAt;
      delete profileData.analysisStartedAt;
      delete profileData.analysisError;
      delete profileData.lastAnalyzedAt;

      const currentNoteCount = await Note.countDocuments({ userId });
      if (currentNoteCount < 5) {
        await this.markAnalysisInsufficient(userId, analysisVersion);
        return { committed: false, reason: 'insufficient_data' };
      }

      const committed = await this.commitProfileResult(userId, analysisVersion, profileData, notes.length);

      if (committed) {
        logger.info(`User profile updated for user: ${userId}, version: ${analysisVersion}`);
        return { committed: true, reason: 'updated' };
      }

      logger.warn(`Skipped stale user profile analysis result for user: ${userId}, version: ${analysisVersion}`);
      return { committed: false, reason: 'stale_analysis_version' };

    } catch (error) {
      logger.error('Error analyzing user profile:', error);
      throw error;
    }
  }
}

export const userAnalysisService = new UserAnalysisService();
