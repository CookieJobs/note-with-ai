import mongoose from 'mongoose';

const InterestSchema = new mongoose.Schema({
  topic: { type: String, required: true },
  score: { type: Number, default: 0.5 }, // 0 to 1, relevance/strength
  lastUpdated: { type: Date, default: Date.now }
}, { _id: false });

const ExpertiseSchema = new mongoose.Schema({
  area: { type: String, required: true },
  level: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced', 'Expert'], default: 'Intermediate' }
}, { _id: false });

const GoalSchema = new mongoose.Schema({
  description: { type: String, required: true },
  timeframe: { type: String, enum: ['Short-term', 'Long-term'], default: 'Short-term' },
  status: { type: String, enum: ['Active', 'Completed', 'Abandoned'], default: 'Active' },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const ThemeSchema = new mongoose.Schema({
  themeName: { type: String, required: true },
  cssType: { type: String, required: true },
  cssValue: { type: String, required: true },
  reasoning: { type: String, required: true }
}, { _id: false });

const UserProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    
    // Extracted Interests
    interests: [InterestSchema],
    
    // User Expertise Areas
    expertise: [ExpertiseSchema],
    
    // User Goals
    goals: [GoalSchema],
    
    // User Preferences (e.g., communication style, content types)
    preferences: {
      communicationStyle: { type: String, default: 'Neutral' },
      contentFocus: [{ type: String }], // e.g., "Technical", "Philosophical"
      feedbackMode: { type: String, enum: ['Gentle', 'Direct'], default: 'Gentle' }
    },
    
    // Long-term Biography / Summary
    summary: { type: String, default: '' },
    
    // AI Generated Background Theme
    theme: ThemeSchema,
    
    // Track when the profile was last updated by the analysis job
    lastAnalyzedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export default mongoose.model('UserProfile', UserProfileSchema);
