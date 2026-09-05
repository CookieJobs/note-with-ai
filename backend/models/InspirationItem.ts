import mongoose from 'mongoose';

const RelatedNoteSchema = new mongoose.Schema({
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note', required: true },
  noteRevision: { type: Number, required: true, min: 1 },
  reason: { type: String, required: true, maxlength: 300 },
}, { _id: false });

const SourceSchema = new mongoose.Schema({
  canonicalUrl: { type: String, required: true, maxlength: 2048 },
  title: { type: String, required: true, maxlength: 300 },
  publisher: { type: String, required: true, maxlength: 160 },
  publishedAt: { type: Date, default: undefined },
  retrievedAt: { type: Date, required: true },
  evidenceType: { type: String, required: true, enum: ['provider_snippet', 'fetched_content'] },
}, { _id: false });

const InspirationItemSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  relatedNotes: { type: [RelatedNoteSchema], required: true, validate: [(value: unknown[]) => value.length >= 1 && value.length <= 3, 'relatedNotes must contain 1-3 items'] },
  source: { type: SourceSchema, required: true },
  summary: { type: String, required: true, maxlength: 1000 },
  whyThis: { type: String, required: true, maxlength: 500 },
  status: { type: String, required: true, enum: ['unread', 'read', 'saved', 'dismissed'], default: 'unread' },
}, { timestamps: true, versionKey: false });

InspirationItemSchema.index({ userId: 1, 'source.canonicalUrl': 1, createdAt: -1 });
InspirationItemSchema.index({ userId: 1, status: 1, updatedAt: -1 });

const InspirationItem = mongoose.models.InspirationItem || mongoose.model('InspirationItem', InspirationItemSchema);
export default InspirationItem;

