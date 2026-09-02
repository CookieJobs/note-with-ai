import mongoose from 'mongoose';

const NoteEvidenceSchema = new mongoose.Schema({
  noteId: { type: String, required: true },
  revision: { type: Number, required: true, min: 1 },
  excerpt: { type: String, required: true, maxlength: 600 },
  occurredAt: { type: Date, required: true },
}, { _id: false });

const NoteRelationshipSchema = new mongoose.Schema({
  relationshipId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  source: { type: NoteEvidenceSchema, required: true },
  candidate: { type: NoteEvidenceSchema, required: true },
  kind: { type: String, enum: ['continuation', 'contrast', 'change', 'tension', 'shared_origin'], required: true },
  headline: { type: String, required: true, maxlength: 120 },
  explanation: { type: String, required: true, maxlength: 600 },
  confidence: { type: String, enum: ['possible', 'supported'], required: true },
  generatedAt: { type: Date, required: true },
}, { timestamps: true });

NoteRelationshipSchema.index({ userId: 1, 'source.noteId': 1, 'source.revision': 1 });

export const NoteRelationship =
  (mongoose.models.NoteRelationship as mongoose.Model<any>) ||
  mongoose.model('NoteRelationship', NoteRelationshipSchema);
