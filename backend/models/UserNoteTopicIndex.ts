import mongoose from 'mongoose';

export const TOPIC_INDEX_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const;
export type TopicIndexStatus = typeof TOPIC_INDEX_STATUSES[number];
export const TOPIC_SCOPES = ['all', 'year', 'sixMonths'] as const;
export type TopicScope = typeof TOPIC_SCOPES[number];

const LastSuccessSchema = new mongoose.Schema(
  {
    sourceRevision: { type: Number, required: true },
    sourceFingerprint: { type: String, required: true },
    topics: { type: [String], required: true, default: [] },
    source: { type: String, enum: ['keywords', 'summary', 'bounded_content', 'mixed'], required: true },
    indexedAt: { type: Date, required: true },
  },
  { _id: false },
);

const UserNoteTopicIndexSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note', required: true },
    sourceRevision: { type: Number, required: true, min: 1 },
    sourceFingerprint: { type: String, required: true },
    status: { type: String, enum: TOPIC_INDEX_STATUSES, required: true, default: 'pending' },
    topics: { type: [String], required: true, default: [] },
    source: { type: String, enum: ['keywords', 'summary', 'bounded_content', 'mixed'], required: true },
    indexedAt: { type: Date, default: null },
    errorAt: { type: Date, default: null },
    lastSuccess: { type: LastSuccessSchema, default: null },
    lastAttemptAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: null },
    retryMode: { type: String, enum: ['automatic', 'manual', null], default: null },
    nextAttemptAt: { type: Date, default: null },
    automaticAttemptCount: { type: Number, min: 0, default: 0 },
    automaticAttemptFingerprint: { type: String, default: null },
    // Keep these timestamps independent of source revision so rolling manual quota survives edits.
    manualAttemptTimestamps: { type: [Date], default: [] },
    lastManualAttemptFingerprint: { type: String, default: null },
    lastManualAttemptAt: { type: Date, default: null },
    // Lease fields and a monotonically increasing claim version support worker recovery and CAS writes.
    claimToken: { type: String, default: null },
    leaseUntil: { type: Date, default: null },
    claimVersion: { type: Number, min: 0, default: 0 },
    scheduledAt: { type: Date, default: null },
    projectionFence: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

UserNoteTopicIndexSchema.index({ userId: 1, noteId: 1 }, { unique: true });
UserNoteTopicIndexSchema.index({ status: 1, leaseUntil: 1 });

const UserNoteTopicIndex = (mongoose.models.UserNoteTopicIndex as mongoose.Model<any>)
  || mongoose.model('UserNoteTopicIndex', UserNoteTopicIndexSchema);

export default UserNoteTopicIndex;
