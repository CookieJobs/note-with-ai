import mongoose from 'mongoose';
import {
  DISCOVERY_FAILURE_CATEGORIES,
  DISCOVERY_RUN_STATUSES,
  DISCOVERY_TRIGGERS,
  type DiscoveryRunRecord,
  type DiscoveryRunUsage,
  type DiscoveryWatermark,
} from '../types/noteDiscovery';

const nonnegativeInteger = { type: Number, min: 0, validate: Number.isSafeInteger } as const;
const nullableInteger = { ...nonnegativeInteger, validate: (value: number | null) => value === null || Number.isSafeInteger(value) };
const WatermarkSchema = new mongoose.Schema<DiscoveryWatermark<mongoose.Types.ObjectId>>({
  changedAt: { type: Date, required: true },
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
  revision: { ...nonnegativeInteger, min: 1 },
}, { _id: false });

const UsageSchema = new mongoose.Schema<DiscoveryRunUsage>({
  modelCalls: { ...nonnegativeInteger, required: true },
  toolCalls: { ...nonnegativeInteger, required: true },
  notesRead: { ...nonnegativeInteger, required: true },
  inputTokens: { ...nullableInteger, default: null },
  outputTokens: { ...nullableInteger, default: null },
  costCnyMicros: { ...nullableInteger, default: null },
}, { _id: false });

const NoteDiscoveryRunSchema = new mongoose.Schema<DiscoveryRunRecord>({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  trigger: { type: String, enum: DISCOVERY_TRIGGERS, required: true, default: 'automatic' },
  status: { type: String, enum: DISCOVERY_RUN_STATUSES, required: true, default: 'queued' },
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 200 },
  idempotencyAliases: { type: [{ type: String, maxlength: 200 }], default: undefined },
  promotedPendingRunIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
  watermark: { type: WatermarkSchema, required: true },
  pendingWatermark: { type: WatermarkSchema },
  pendingIdempotencyKey: { type: String, trim: true, maxlength: 200 },
  pendingAvailableAt: { type: Date },
  pendingTrigger: { type: String, enum: DISCOVERY_TRIGGERS },
  availableAt: { type: Date, required: true, default: Date.now },
  leaseToken: { type: String, maxlength: 100, default: null },
  leaseUntil: { type: Date, default: null },
  generation: { ...nonnegativeInteger, required: true, default: 0 },
  retryCount: { ...nonnegativeInteger, max: 1, required: true, default: 0 },
  providerStartedAt: { type: Date, default: null },
  providerReservationId: { type: String, maxlength: 48, default: null },
  providerDeliveryUnknown: { type: Boolean },
  executionCancelled: { type: Boolean },
  cleanupRequested: { type: Boolean },
  sentReservationIds: { type: [{ type: String, maxlength: 48 }], default: undefined },
  recoveringGeneration: { ...nullableInteger, default: null },
  startedAt: { type: Date },
  finishedAt: { type: Date },
  usage: { type: UsageSchema },
  failureCategory: { type: String, enum: DISCOVERY_FAILURE_CATEGORIES },
}, { timestamps: true, versionKey: false });

NoteDiscoveryRunSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
NoteDiscoveryRunSchema.index({ userId: 1, idempotencyAliases: 1 }, {
  unique: true,
  partialFilterExpression: { idempotencyAliases: { $exists: true } },
});
NoteDiscoveryRunSchema.index({ userId: 1, promotedPendingRunIds: 1 }, {
  unique: true,
  partialFilterExpression: { promotedPendingRunIds: { $exists: true } },
});
NoteDiscoveryRunSchema.index({ userId: 1 }, {
  unique: true,
  partialFilterExpression: { status: { $in: ['queued', 'running'] } },
});
NoteDiscoveryRunSchema.index({ status: 1, leaseUntil: 1 });
NoteDiscoveryRunSchema.index({ status: 1, availableAt: 1 });
NoteDiscoveryRunSchema.index({ userId: 1, trigger: 1, createdAt: -1 });
NoteDiscoveryRunSchema.index({ updatedAt: 1 }, {
  partialFilterExpression: { pendingWatermark: { $exists: true } },
});

export const NoteDiscoveryRun = (mongoose.models.NoteDiscoveryRun as mongoose.Model<DiscoveryRunRecord>)
  || mongoose.model<DiscoveryRunRecord>('NoteDiscoveryRun', NoteDiscoveryRunSchema);

export default NoteDiscoveryRun;
