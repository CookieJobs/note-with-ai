import mongoose from 'mongoose';
import {
  DISCOVERY_KINDS,
  DISCOVERY_STATUSES,
  type DiscoveryEvidenceSnapshot,
  type DiscoveryQualityRationale,
  type DiscoveryRecord,
  type EvidenceLocator,
} from '../types/noteDiscovery';

const LocatorSchema = new mongoose.Schema<EvidenceLocator>({
  start: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  end: {
    type: Number, required: true,
    validate: {
      validator(this: EvidenceLocator, value: number) {
        return Number.isSafeInteger(value) && value > this.start;
      },
      message: 'The evidence locator end must be after its start.',
    },
  },
}, { _id: false });

const EvidenceSchema = new mongoose.Schema<DiscoveryEvidenceSnapshot>({
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note', required: true },
  revision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  title: { type: String, default: '' },
  noteDate: { type: Date, required: true },
  excerpt: { type: String, required: true },
  locator: { type: LocatorSchema },
  hasImages: { type: Boolean, required: true },
}, { _id: false });

const RationaleSchema = new mongoose.Schema<DiscoveryQualityRationale>({
  novelInsight: { type: String, required: true, trim: true, maxlength: 1500 },
  counterEvidence: { type: String, required: true, trim: true, maxlength: 1500 },
  missingInformation: { type: [{ type: String, trim: true, maxlength: 500 }], default: [] },
}, { _id: false });

const QualitySchema = new mongoose.Schema<DiscoveryRecord['quality']>({
  passed: { type: Boolean, required: true, validate: (value: boolean) => value === true },
  rationale: { type: RationaleSchema, required: true },
}, { _id: false });

const NoteDiscoverySchema = new mongoose.Schema<DiscoveryRecord>({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  runId: { type: mongoose.Schema.Types.ObjectId, ref: 'NoteDiscoveryRun', required: true },
  generation: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  kind: { type: String, enum: DISCOVERY_KINDS, required: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  observation: { type: String, required: true, trim: true, maxlength: 2000 },
  whyNow: { type: String, required: true, trim: true, maxlength: 1500 },
  qualification: { type: String, required: true, trim: true, maxlength: 1500 },
  suggestedAction: { type: String, required: true, trim: true, maxlength: 1500 },
  draft: { type: String, maxlength: 16000 },
  evidence: {
    type: [EvidenceSchema], required: true,
    validate: (items: DiscoveryEvidenceSnapshot[]) => items.length > 0,
  },
  sourceFingerprint: { type: String, required: true, trim: true, maxlength: 200 },
  observationFingerprint: { type: String, required: true, trim: true, maxlength: 200 },
  relationshipKey: { type: String, trim: true, maxlength: 200 },
  questionKey: { type: String, trim: true, maxlength: 200 },
  quality: { type: QualitySchema, required: true },
  status: { type: String, enum: DISCOVERY_STATUSES, required: true, default: 'ready' },
  exposedAt: { type: Date },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
  savedNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
}, { timestamps: true, versionKey: false });

NoteDiscoverySchema.index({ userId: 1, runId: 1, generation: 1, observationFingerprint: 1 }, { unique: true });
NoteDiscoverySchema.index({ userId: 1, status: 1, createdAt: -1 });
NoteDiscoverySchema.index({ userId: 1, exposedAt: -1 });
NoteDiscoverySchema.index({ userId: 1, 'evidence.noteId': 1 });

export const NoteDiscovery = (mongoose.models.NoteDiscovery as mongoose.Model<DiscoveryRecord>)
  || mongoose.model<DiscoveryRecord>('NoteDiscovery', NoteDiscoverySchema);

export default NoteDiscovery;
