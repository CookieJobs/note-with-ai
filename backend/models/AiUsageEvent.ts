import mongoose from 'mongoose';

export const AI_USAGE_OPERATIONS = [
  'chat', 'chat_title', 'note_meta', 'note_concepts', 'rerank', 'embedding', 'care_intro',
] as const;

export const AI_USAGE_PROVIDERS = ['deepseek', 'openrouter', 'dashscope'] as const;

const AiUsageEventSchema = new mongoose.Schema({
  requestId: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
  userId: { type: mongoose.Schema.Types.ObjectId, required: false, index: true },
  provider: { type: String, required: true, enum: AI_USAGE_PROVIDERS },
  model: { type: String, required: true, trim: true, maxlength: 200 },
  operation: { type: String, required: true, enum: AI_USAGE_OPERATIONS },
  status: { type: String, required: true, enum: ['succeeded', 'failed', 'aborted'] },
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date, required: true },
  durationMs: { type: Number, required: true, min: 0 },
  inputTokens: { type: Number, default: null, min: 0 },
  outputTokens: { type: Number, default: null, min: 0 },
  totalTokens: { type: Number, default: null, min: 0 },
  estimatedCostMicros: { type: Number, default: null, min: 0 },
  currency: { type: String, required: true, enum: ['CNY'], default: 'CNY' },
  errorCode: { type: String, maxlength: 100 },
}, { versionKey: false });

AiUsageEventSchema.index({ startedAt: -1 });
AiUsageEventSchema.index({ userId: 1, startedAt: -1 });
AiUsageEventSchema.index({ provider: 1, operation: 1, startedAt: -1 });
AiUsageEventSchema.index({ status: 1, startedAt: -1 });

export const AiUsageEvent = mongoose.models.AiUsageEvent
  || mongoose.model('AiUsageEvent', AiUsageEventSchema);

export default AiUsageEvent;
