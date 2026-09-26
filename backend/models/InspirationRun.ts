import mongoose from 'mongoose';

const InspirationRunSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cycleAt: { type: Date, required: true },
  attemptAt: { type: Date, required: true },
  state: { type: String, required: true, enum: ['queued', 'claimed', 'provider_started', 'completed', 'no_result', 'failed', 'cancelled'] },
  token: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
  budgetDay: { type: String, required: true },
}, { timestamps: true, versionKey: false });

InspirationRunSchema.index({ userId: 1, cycleAt: 1 }, { unique: true });
InspirationRunSchema.index({ state: 1, leaseUntil: 1 });

const InspirationRun = mongoose.models.InspirationRun || mongoose.model('InspirationRun', InspirationRunSchema);
export default InspirationRun;
