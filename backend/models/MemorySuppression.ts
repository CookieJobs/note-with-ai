import mongoose from 'mongoose';

const MemorySuppressionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fingerprint: { type: String, required: true, minlength: 16, maxlength: 128 },
  reason: { type: String, required: true, enum: ['deleted_by_user', 'superseded_by_correction'] },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

MemorySuppressionSchema.index({ userId: 1, fingerprint: 1 }, { unique: true });

const MemorySuppression = mongoose.models.MemorySuppression || mongoose.model('MemorySuppression', MemorySuppressionSchema);
export default MemorySuppression;

