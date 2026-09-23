import mongoose from 'mongoose';

const InspirationSourceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  canonicalUrl: { type: String, required: true, trim: true, maxlength: 2048 },
  inspirationId: { type: mongoose.Schema.Types.ObjectId, ref: 'InspirationItem', required: true },
  createdAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

InspirationSourceSchema.index({ userId: 1, canonicalUrl: 1 }, { unique: true });
InspirationSourceSchema.index({ inspirationId: 1 });

const InspirationSource = mongoose.models.InspirationSource
  || mongoose.model('InspirationSource', InspirationSourceSchema);

export default InspirationSource;
