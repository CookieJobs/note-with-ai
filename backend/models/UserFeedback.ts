import mongoose from 'mongoose';

export const FEEDBACK_CATEGORIES = ['bug', 'feature', 'other'] as const;
export const FEEDBACK_STATUSES = ['new', 'in_progress', 'resolved', 'closed'] as const;
const UserFeedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  content: { type: String, required: true, minlength: 5, maxlength: 2000, trim: true },
  category: { type: String, required: true, enum: FEEDBACK_CATEGORIES },
  contact: { type: String, maxlength: 200, trim: true },
  appVersion: { type: String, maxlength: 50, trim: true },
  status: { type: String, enum: FEEDBACK_STATUSES, default: 'new', required: true },
  internalNote: { type: String, maxlength: 2000, select: false },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminAccount' },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });
UserFeedbackSchema.index({ userId: 1, createdAt: -1 });
UserFeedbackSchema.index({ status: 1, createdAt: -1 });
export const UserFeedback = mongoose.models.UserFeedback || mongoose.model('UserFeedback', UserFeedbackSchema);
export default UserFeedback;
