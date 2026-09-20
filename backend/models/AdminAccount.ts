import mongoose from 'mongoose';

export const ADMIN_ROLES = ['owner', 'operator', 'support', 'viewer'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

const AdminAccountSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    passwordHash: { type: String, required: true, select: false },
    totpSecretEncrypted: { type: String, required: true, select: false },
    role: { type: String, enum: ADMIN_ROLES, required: true, default: 'viewer' },
    isActive: { type: Boolean, required: true, default: true },
    tokenVersion: { type: Number, required: true, default: 0, min: 0 },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_document, result) => {
        Reflect.deleteProperty(result, 'passwordHash');
        Reflect.deleteProperty(result, 'totpSecretEncrypted');
        return result;
      },
    },
  },
);

AdminAccountSchema.index({ isActive: 1, role: 1 });

export const AdminAccount = mongoose.models.AdminAccount
  || mongoose.model('AdminAccount', AdminAccountSchema);

export default AdminAccount;
