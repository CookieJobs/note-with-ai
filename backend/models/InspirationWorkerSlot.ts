import mongoose from 'mongoose';

const InspirationWorkerSlotSchema = new mongoose.Schema({
  slot: { type: Number, required: true, unique: true, min: 0 },
  token: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
}, { versionKey: false });

const InspirationWorkerSlot = mongoose.models.InspirationWorkerSlot
  || mongoose.model('InspirationWorkerSlot', InspirationWorkerSlotSchema);
export default InspirationWorkerSlot;
