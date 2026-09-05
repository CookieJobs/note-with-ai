import mongoose from 'mongoose';

export const MEMORY_INSIGHT_KINDS = [
  'recurring_interest',
  'ongoing_question',
  'stated_goal',
  'preference',
  'change_over_time',
] as const;

export const MEMORY_INSIGHT_STATUSES = ['proposed', 'confirmed', 'corrected'] as const;

const EvidenceSchema = new mongoose.Schema({
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note', required: true },
  noteRevision: { type: Number, required: true, min: 1 },
  excerpt: { type: String, required: true, maxlength: 1000 },
  capturedAt: { type: Date, required: true },
}, { _id: false });

const MemoryInsightSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, required: true, enum: MEMORY_INSIGHT_KINDS },
  statement: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, required: true, enum: MEMORY_INSIGHT_STATUSES, default: 'proposed' },
  evidence: { type: [EvidenceSchema], required: true, default: [] },
  confidence: { type: String, required: true, enum: ['tentative', 'supported'], default: 'tentative' },
  userCorrection: { type: String, trim: true, maxlength: 500, default: undefined },
  fingerprint: { type: String, required: true, minlength: 16, maxlength: 128 },
  generatedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true, versionKey: false });

MemoryInsightSchema.index({ userId: 1, status: 1, updatedAt: -1 });
MemoryInsightSchema.index({ userId: 1, fingerprint: 1 });

const MemoryInsight = mongoose.models.MemoryInsight || mongoose.model('MemoryInsight', MemoryInsightSchema);
export default MemoryInsight;

