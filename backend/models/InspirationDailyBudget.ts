import mongoose from 'mongoose';

const InspirationDailyBudgetSchema = new mongoose.Schema({
  day: { type: String, required: true, unique: true },
  count: { type: Number, required: true, default: 0, min: 0 },
}, { versionKey: false });

const InspirationDailyBudget = mongoose.models.InspirationDailyBudget
  || mongoose.model('InspirationDailyBudget', InspirationDailyBudgetSchema);
export default InspirationDailyBudget;
