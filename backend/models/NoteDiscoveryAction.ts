import mongoose from 'mongoose';

/** Durable create intent: target identity and confirmed payload survive create/reference crashes. */
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  discoveryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  kind: { type: String, enum: ['session', 'save'], required: true, immutable: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
}, { timestamps: true });
schema.index({ userId: 1, discoveryId: 1, kind: 1 }, { unique: true });
export const NoteDiscoveryAction = mongoose.models.NoteDiscoveryAction || mongoose.model('NoteDiscoveryAction', schema);
