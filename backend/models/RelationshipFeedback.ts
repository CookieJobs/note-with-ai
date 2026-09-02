import mongoose from 'mongoose';

const RelationshipFeedbackSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    relationshipId: { type: String, required: true },
    sourceNoteId: { type: String, required: true },
    candidateNoteId: { type: String, required: true },
    noteIds: {
      type: [{ type: String, required: true }],
      required: true,
      validate: {
        validator: (value: unknown) => Array.isArray(value) && value.length === 2,
        message: 'noteIds 必须包含两条笔记',
      },
    },
    sourceRevision: { type: Number, required: true, min: 1 },
    candidateRevision: { type: Number, required: true, min: 1 },
    verdict: { type: String, enum: ['helpful', 'not_relevant', 'hide_pair'], required: true },
  },
  { timestamps: true },
);

RelationshipFeedbackSchema.index({ userId: 1, relationshipId: 1 }, { unique: true });
RelationshipFeedbackSchema.index({ userId: 1, noteIds: 1, verdict: 1 });

export const RelationshipFeedback =
  (mongoose.models.RelationshipFeedback as mongoose.Model<any>) ||
  mongoose.model('RelationshipFeedback', RelationshipFeedbackSchema);
