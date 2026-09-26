import mongoose from 'mongoose';

const InspirationResearchGateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  token: { type: String, default: null },
  origin: { type: String, enum: ['manual', 'scheduled', null], default: null },
  busyUntil: { type: Date, default: null },
}, { versionKey: false });

const InspirationResearchGate = mongoose.models.InspirationResearchGate
  || mongoose.model('InspirationResearchGate', InspirationResearchGateSchema);
export default InspirationResearchGate;
