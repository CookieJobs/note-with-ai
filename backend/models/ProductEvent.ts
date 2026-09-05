import mongoose from 'mongoose';

export const PRODUCT_EVENT_NAMES = [
  'user_registered',
  'user_active_day',
  'note_created',
  'chat_turn_committed',
  'association_opened',
  'feedback_submitted',
  'memory_viewed',
  'memory_evidence_opened',
  'memory_confirmed',
  'memory_corrected',
  'memory_deleted',
  'note_ai_preference_changed',
  'publication_created',
  'publication_snapshot_updated',
  'publication_revoked',
  'inspiration_requested',
  'inspiration_source_opened',
  'inspiration_generated',
  'inspiration_generation_failed',
  'inspiration_saved',
  'inspiration_dismissed',
] as const;

export type ProductEventName = typeof PRODUCT_EVENT_NAMES[number];

const ProductEventSchema = new mongoose.Schema({
  name: { type: String, required: true, enum: PRODUCT_EVENT_NAMES },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  occurredAt: { type: Date, required: true, default: Date.now },
  dayKey: { type: String, required: true },
  source: { type: String, required: true, enum: ['server', 'web'] },
  properties: { type: mongoose.Schema.Types.Mixed, required: true, default: {} },
}, { versionKey: false });

ProductEventSchema.index({ name: 1, userId: 1, dayKey: 1 }, { unique: true, partialFilterExpression: { name: 'user_active_day' } });
ProductEventSchema.index({ name: 1, occurredAt: 1 });
ProductEventSchema.index({ userId: 1, occurredAt: 1 });
ProductEventSchema.index({ occurredAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });

const ProductEvent = mongoose.models.ProductEvent || mongoose.model('ProductEvent', ProductEventSchema);
export default ProductEvent;
