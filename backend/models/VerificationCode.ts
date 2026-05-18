import mongoose from 'mongoose';

const VerificationCodeSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    code: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: ['register', 'reset'],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    used: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// TTL 索引：文档到期后自动删除
VerificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// 复合索引：按邮箱和用途查询
VerificationCodeSchema.index({ email: 1, purpose: 1 });

const VerificationCode =
  mongoose.models.VerificationCode ||
  mongoose.model('VerificationCode', VerificationCodeSchema);

export default VerificationCode;
