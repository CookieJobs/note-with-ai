import mongoose from 'mongoose';

const PublishedNoteSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sourceNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note', required: true },
  sourceRevision: { type: Number, required: true, min: 1 },
  slug: { type: String, required: true, minlength: 20, maxlength: 128 },
  title: { type: String, trim: true, maxlength: 200, default: undefined },
  contentSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  authorDisplayName: { type: String, trim: true, maxlength: 80, default: undefined },
  status: { type: String, required: true, enum: ['active', 'revoked'], default: 'active' },
  publishedAt: { type: Date, required: true, default: Date.now },
  revokedAt: { type: Date, default: undefined },
}, { timestamps: true, versionKey: false });

PublishedNoteSchema.index({ slug: 1 }, { unique: true });
PublishedNoteSchema.index({ ownerUserId: 1, status: 1, updatedAt: -1 });
PublishedNoteSchema.index({ ownerUserId: 1, sourceNoteId: 1 });

const PublishedNote = mongoose.models.PublishedNote || mongoose.model('PublishedNote', PublishedNoteSchema);
export default PublishedNote;

