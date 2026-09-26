import mongoose from 'mongoose';

const InspirationSettingsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  enabled: { type: Boolean, required: true, default: false },
  consentedAt: { type: Date, default: null },
  nextEligibleAt: { type: Date, default: null },
  lastAttemptAt: { type: Date, default: null },
  lastStatus: { type: String, enum: ['completed', 'no_result', 'failed', 'cancelled', 'deferred', null], default: null },
}, { timestamps: true, versionKey: false });

InspirationSettingsSchema.index({ enabled: 1, nextEligibleAt: 1 });

const InspirationSettings = mongoose.models.InspirationSettings
  || mongoose.model('InspirationSettings', InspirationSettingsSchema);
export default InspirationSettings;
