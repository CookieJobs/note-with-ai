/*
Input: 应用账户资料与管理员授予的笔记发现权限
Output: 用户模型，公开 JSON 排除密码和发现授权字段
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/models/User.ts
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      trim: true,
      minlength: 2,
      maxlength: 20
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },
    password: {
      type: String,
      required: true,
      minlength: 8
    },
    avatar: {
      type: String,
      default: ''
    },
    isActive: {
      type: Boolean,
      default: true
    },
    noteDiscoveryAccess: { type: Boolean, select: false },
    lastActiveAt: {
      type: Date,
      default: null
    },
    isVerified: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

// 密码加密中间件
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error as any);
  }
});

// 密码验证方法
UserSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// 转换为JSON时移除密码字段
UserSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.noteDiscoveryAccess;
  return userObject;
};

UserSchema.index({ createdAt: 1 });
UserSchema.index({ lastActiveAt: 1 });
UserSchema.index({ noteDiscoveryAccess: 1, _id: 1 }, { partialFilterExpression: { noteDiscoveryAccess: true } });

const User = mongoose.models.User || mongoose.model('User', UserSchema);
export default User;
