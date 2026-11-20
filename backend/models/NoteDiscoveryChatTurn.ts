import mongoose from 'mongoose';

/** A single paid conversation attempt. Replays never dispatch again, including after an expired lease. */
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  chatId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  requestId: { type: String, required: true, maxlength: 150, immutable: true },
  status: { type: String, enum: ['running', 'completed', 'failed'], required: true },
  generation: { type: Number, required: true, default: 1 },
  leaseToken: { type: String, required: true },
  leaseUntil: { type: Date, required: true },
  providerReservationId: { type: String, default: null },
  providerStartedAt: Date,
  executionCancelled: Boolean,
  cleanupRequested: Boolean,
  payload: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  reply: String,
  errorCode: String,
}, { timestamps: true });
schema.index({ userId: 1, chatId: 1, requestId: 1 }, { unique: true });
schema.index({ chatId: 1 }, { unique: true, partialFilterExpression: { status: 'running' } });
schema.index({ status: 1, leaseUntil: 1 });
export const NoteDiscoveryChatTurn = mongoose.models.NoteDiscoveryChatTurn || mongoose.model('NoteDiscoveryChatTurn', schema);
