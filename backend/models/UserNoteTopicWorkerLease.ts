import mongoose from 'mongoose';

const UserNoteTopicWorkerLeaseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  ownerToken: { type: String, required: true },
  leaseUntil: { type: Date, required: true },
}, { timestamps: true });

UserNoteTopicWorkerLeaseSchema.index({ leaseUntil: 1 });

const UserNoteTopicWorkerLease = (mongoose.models.UserNoteTopicWorkerLease as mongoose.Model<any>)
  || mongoose.model('UserNoteTopicWorkerLease', UserNoteTopicWorkerLeaseSchema);

export default UserNoteTopicWorkerLease;
