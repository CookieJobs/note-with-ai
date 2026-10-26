import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: String, required: true },
  attempts: { type: [Date], default: [] },
  ownerToken: { type: String, default: null },
  busyUntil: { type: Date, default: null },
}, { versionKey: false, collection: 'note_title_quotas' });
schema.index({ userId: 1 }, { unique: true });

export const NoteTitleQuota = mongoose.models.NoteTitleQuota || mongoose.model('NoteTitleQuota', schema);
