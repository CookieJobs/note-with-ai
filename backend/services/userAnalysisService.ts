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

      // 2. Call LLM to extract profile and generate background theme
      const prompt = `
        You are a user profiling expert and a top-tier UI/UX designer. Based on the following user notes, extract a structured user profile AND generate a personalized CSS background theme.
        
        CRITICAL INSTRUCTION: All output text (including topics, areas, descriptions, summary, themeName, and reasoning) MUST be in Chinese (简体中文).
        
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
          "summary": string (100-200 words biography),
          "theme": {
            "themeName": "颜色的诗意命名（如：迷雾森林、冰川晨曦）",
            "cssType": "linear-gradient",
            "cssValue": "标准的 CSS background 属性值（必须使用 HEX 或 RGBA 格式，如 linear-gradient(135deg, #E3FDF5 0%, #FFE6FA 100%)）",
            "reasoning": "简短解释为什么选择这个颜色，它是如何体现用户特质的（50字以内）"
          }
        }
        
        THEME GENERATION CONSTRAINTS (Strictly Follow):
        1. Visual Comfort: DO NOT use high-saturation, high-brightness glaring colors (e.g., pure red #FF0000, neon green).
        2. Color Space: MUST use Morandi colors, Macaron colors, or low-saturation pastel colors. Lightness (L in HSL) should be between 85% and 95% to ensure a clean background.
        3. Contrast with White Card: The background CANNOT be pure white (#FFFFFF). It must have enough contrast to distinguish boundaries with a pure white content card floating in the center, but not so dark that it feels oppressive.
        4. Format: Prefer 2-3 colors soft linear-gradient, angle around 120deg to 145deg.
        5. Emotional Mapping: Analyze the user's traits and map them to colors (e.g., tech -> very pale ice blue, literary -> oatmeal or light tea, lively -> pale peach and cream yellow).
  
        Notes:
        ${notesText}
      `;

      const response = await this.getApiClient().chatCompletion([
        { role: 'system', content: 'You are a helpful assistant that outputs JSON. You MUST use Chinese (简体中文) for all text content.' },
        { role: 'user', content: prompt }
      ], {
        temperature: 0.3, // Slightly higher for more creative theme generation
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
