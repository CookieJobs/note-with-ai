import mongoose from 'mongoose';

const UserNoteTopicBackfillSchema = new mongoose.Schema({
  // Per-user note scan cursor; `__runtime__` stores the paged User collection cursor.
  scopeKey: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cursor: { type: mongoose.Schema.Types.ObjectId, default: null },
  done: { type: Boolean, default: false },
  cursorVersion: { type: Number, default: 0, min: 0 },
  leaseToken: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

const UserNoteTopicBackfill = (mongoose.models.UserNoteTopicBackfill as mongoose.Model<any>)
  || mongoose.model('UserNoteTopicBackfill', UserNoteTopicBackfillSchema);

export default UserNoteTopicBackfill;
