import { Note } from '../models/Note';
import UserProfile from '../models/UserProfile';
import { DeepSeekApiClient } from '../utils/apiClient';
import { getDeepSeekClient } from './deepseek';

export class UserAnalysisService {
  private getApiClient(): DeepSeekApiClient {
    return getDeepSeekClient();
  }

  /**
   * Analyze user's recent notes and chat history to update their profile.
   * This should be called by a background job or cron task.
   */
  async analyzeUserProfile(userId: string): Promise<void> {
    try {
      console.log(`Starting user profile analysis for user: ${userId}`);

      // 1. Fetch recent data (e.g., last 20 notes)
      // TODO: Also fetch recent chat history
      const notes = await Note.find({ userId }).sort({ createdAt: -1 }).limit(20);
      
      if (notes.length < 5) {
        console.log('Not enough data to analyze.');
        return;
      }

      const notesText = notes.map(n => 
        `[${n.createdAt.toISOString().split('T')[0]}] ${n.title || 'Untitled'}: ${n.content.substring(0, 500)}`
      ).join('\n---\n');

      // 2. Call LLM to extract profile
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
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      // 3. Parse and Update DB
      const profileData = JSON.parse(response);
      
      // Add timestamps
      if (profileData.interests) {
        profileData.interests.forEach((i: any) => i.lastUpdated = new Date());
      }
      if (profileData.goals) {
        profileData.goals.forEach((g: any) => g.createdAt = new Date());
      }
      profileData.lastAnalyzedAt = new Date();
      profileData.userId = userId;

      // Upsert profile
      await UserProfile.findOneAndUpdate(
        { userId },
        profileData,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      console.log(`User profile updated for user: ${userId}`);

    } catch (error) {
      console.error('Error analyzing user profile:', error);
      throw error;
    }
  }
}

export const userAnalysisService = new UserAnalysisService();
