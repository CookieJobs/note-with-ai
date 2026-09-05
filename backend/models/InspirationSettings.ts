import mongoose from 'mongoose';

const InspirationSettingsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  proactiveEnabled: { type: Boolean, required: true, default: false },
  lastProactiveRunAt: { type: Date, default: undefined },
}, { timestamps: true, versionKey: false });

InspirationSettingsSchema.index({ userId: 1 }, { unique: true });

const InspirationSettings = mongoose.models.InspirationSettings || mongoose.model('InspirationSettings', InspirationSettingsSchema);
export default InspirationSettings;

