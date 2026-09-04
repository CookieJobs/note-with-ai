import mongoose from 'mongoose';

const FeedbackSubmissionWindowSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  hourKey: { type: Date, required: true },
  count: { type: Number, required: true, default: 0, min: 0, max: 5 },
}, { timestamps: true, versionKey: false });

FeedbackSubmissionWindowSchema.index({ userId: 1, hourKey: 1 }, { unique: true });
FeedbackSubmissionWindowSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2 * 60 * 60 });

export const FeedbackSubmissionWindow = mongoose.models.FeedbackSubmissionWindow
  || mongoose.model('FeedbackSubmissionWindow', FeedbackSubmissionWindowSchema);

export default FeedbackSubmissionWindow;
