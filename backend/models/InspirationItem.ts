import mongoose from 'mongoose';

const RelatedNoteSchema = new mongoose.Schema({
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note', required: true },
  revision: { type: Number, required: true, min: 1 },
}, { _id: false });

const SourceSchema = new mongoose.Schema({
  sourceId: { type: String, required: true, trim: true, maxlength: 8 },
  canonicalUrl: { type: String, required: true, trim: true, maxlength: 2048 },
  title: { type: String, required: true, trim: true, maxlength: 300 },
  publisher: { type: String, required: true, trim: true, maxlength: 160 },
  snippet: { type: String, required: true, trim: true, maxlength: 1000 },
  retrievedAt: { type: Date, required: true },
}, { _id: false });

const InspirationItemSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  relatedNotes: {
    type: [RelatedNoteSchema], required: true,
    validate: [(value: unknown[]) => value.length >= 1 && value.length <= 5, 'relatedNotes must contain 1-5 notes'],
  },
  topicLabel: { type: String, required: true, trim: true, maxlength: 80 },
  headline: { type: String, required: true, trim: true, maxlength: 40 },
  brief: { type: String, required: true, trim: true, maxlength: 500 },
  whyRelevant: { type: String, required: true, trim: true, maxlength: 180 },
  nextQuestion: { type: String, required: true, trim: true, maxlength: 120 },
  sources: {
    type: [SourceSchema], required: true,
    validate: [(value: unknown[]) => value.length >= 1 && value.length <= 3, 'sources must contain 1-3 items'],
  },
  status: { type: String, required: true, enum: ['draft', 'completed'], default: 'draft' },
  userState: { type: String, enum: ['regular', 'saved', 'dismissed'], default: 'regular' },
  userStateChangedAt: { type: Date, default: null },
  origin: { type: String, enum: ['manual', 'scheduled'], default: 'manual' },
  viewedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

InspirationItemSchema.index({ userId: 1, status: 1, createdAt: -1, _id: -1 });
InspirationItemSchema.index({ userId: 1, status: 1, userState: 1, userStateChangedAt: -1, _id: -1 });

const InspirationItem = mongoose.models.InspirationItem
  || mongoose.model('InspirationItem', InspirationItemSchema);

export default InspirationItem;
