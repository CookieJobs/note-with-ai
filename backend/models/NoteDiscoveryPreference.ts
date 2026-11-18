import mongoose from 'mongoose';
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
}, { timestamps: true, versionKey: false });

NoteDiscoveryPreferenceSchema.index({ userId: 1 }, { unique: true });

export const NoteDiscoveryPreference = (mongoose.models.NoteDiscoveryPreference as mongoose.Model<DiscoveryPreferenceRecord>)
  || mongoose.model<DiscoveryPreferenceRecord>('NoteDiscoveryPreference', NoteDiscoveryPreferenceSchema);

export default NoteDiscoveryPreference;
