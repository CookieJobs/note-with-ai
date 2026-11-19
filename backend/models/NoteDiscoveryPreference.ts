import mongoose from 'mongoose';
import { DiscoverySourceBodyBaselineSchema } from './NoteDiscovery';
import {
  DEFAULT_DISCOVERY_TIME_ZONE,
  DISCOVERY_FEEDBACK_KINDS,
  type DiscoveryFeedback,
  type DiscoveryPreferenceRecord,
} from '../types/noteDiscovery';

const FeedbackSchema = new mongoose.Schema<DiscoveryFeedback<mongoose.Types.ObjectId>>({
  kind: { type: String, enum: DISCOVERY_FEEDBACK_KINDS, required: true },
  discoveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'NoteDiscovery', required: true },
  sourceIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Note' }], required: true,
    validate: (ids: mongoose.Types.ObjectId[]) => ids.length > 0,
  },
  sourceFingerprint: { type: String, required: true, trim: true, maxlength: 200 },
  sourceBodyBaselines: { type: [DiscoverySourceBodyBaselineSchema], default: undefined },
  observationFingerprint: { type: String, required: true, trim: true, maxlength: 200 },
  relationshipKey: { type: String, trim: true, maxlength: 200 },
  questionKey: { type: String, trim: true, maxlength: 200 },
  createdAt: { type: Date, required: true, default: Date.now },
  expiresAt: { type: Date },
  revokedAt: { type: Date },
}, { _id: false });

const NoteDiscoveryPreferenceSchema = new mongoose.Schema<DiscoveryPreferenceRecord>({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  automaticEnabled: { type: Boolean, required: true, default: true },
  timeZone: {
    type: String, required: true, trim: true, maxlength: 100, default: DEFAULT_DISCOVERY_TIME_ZONE,
    validate: {
      validator(value: string) {
        if (value.startsWith('+') || value.startsWith('-')) return false;
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      },
      message: 'An IANA time zone is required.',
    },
  },
  feedback: { type: [FeedbackSchema], default: [] },
  // Versioned single-document scheduling outbox and quota receipts. Only the scheduler mutates this state.
  schedule: { type: new mongoose.Schema({
    version: { type: Number, required: true, default: 0 },
    initialized: { type: Boolean, required: true, default: false },
    epoch: { type: Number, required: true, default: 0 },
    changedWatermark: { type: new mongoose.Schema({
      changedAt: { type: Date, required: true }, noteId: mongoose.Schema.Types.ObjectId, revision: Number,
    }, { _id: false }) },
    dueAt: Date,
    lastSuccessfulWatermark: { type: new mongoose.Schema({
      changedAt: { type: Date, required: true }, noteId: mongoose.Schema.Types.ObjectId, revision: Number,
    }, { _id: false }) },
    lastSuccessfulAt: Date,
    admissions: { type: [new mongoose.Schema({
      runId: { type: String, required: true }, trigger: { type: String, enum: ['automatic', 'manual'], required: true },
      at: { type: Date, required: true },
    }, { _id: false })], default: [] },
  }, { _id: false }) },
}, { timestamps: true, versionKey: false });

NoteDiscoveryPreferenceSchema.index({ userId: 1 }, { unique: true });
NoteDiscoveryPreferenceSchema.index({ automaticEnabled: 1, 'schedule.dueAt': 1, userId: 1 });

export const NoteDiscoveryPreference = (mongoose.models.NoteDiscoveryPreference as mongoose.Model<DiscoveryPreferenceRecord>)
  || mongoose.model<DiscoveryPreferenceRecord>('NoteDiscoveryPreference', NoteDiscoveryPreferenceSchema);

export default NoteDiscoveryPreference;
