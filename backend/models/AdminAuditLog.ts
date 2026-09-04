import mongoose from 'mongoose';

const AdminAuditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminAccount' },
    requestId: { type: String, required: true, unique: true, trim: true },
    action: { type: String, required: true, trim: true, maxlength: 100 },
    status: { type: String, required: true, enum: ['pending', 'succeeded', 'failed'], default: 'pending' },
    targetType: { type: String, trim: true, maxlength: 100 },
    targetId: { type: String, trim: true, maxlength: 200 },
    metadata: { type: mongoose.Schema.Types.Mixed },
    errorCode: { type: String, trim: true, maxlength: 100 },
  },
  { timestamps: true },
);

AdminAuditLogSchema.index({ createdAt: -1 });
AdminAuditLogSchema.index({ actorId: 1, createdAt: -1 });
AdminAuditLogSchema.index({ action: 1, createdAt: -1 });

export const AdminAuditLog = mongoose.models.AdminAuditLog
  || mongoose.model('AdminAuditLog', AdminAuditLogSchema);

export default AdminAuditLog;
