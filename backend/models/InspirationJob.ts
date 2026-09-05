import mongoose from 'mongoose';

const InspirationJobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trigger: { type: String, required: true, enum: ['manual', 'proactive'] },
  status: { type: String, required: true, enum: ['queued', 'running', 'completed', 'no_result', 'failed'], default: 'queued' },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InspirationItem', default: undefined },
  failureCode: { type: String, maxlength: 100, default: undefined },
  completedAt: { type: Date, default: undefined },
}, { timestamps: true, versionKey: false });

InspirationJobSchema.index({ userId: 1, status: 1, createdAt: -1 });
InspirationJobSchema.index({ status: 1, createdAt: 1 });
InspirationJobSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['queued', 'running'] } } });

const InspirationJob = mongoose.models.InspirationJob || mongoose.model('InspirationJob', InspirationJobSchema);
export default InspirationJob;
