import mongoose from 'mongoose';
import dotenv from 'dotenv';
import UserProfile from './backend/models/UserProfile.js';

dotenv.config();

async function update() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai');
  const result = await UserProfile.updateMany({}, {
    $set: {
      theme: {
        themeName: "治愈手账",
        cssType: "linear-gradient",
        cssValue: "linear-gradient(135deg, #FFE6FA 0%, #FFF5E6 100%)",
        reasoning: "用户喜欢手工与涂鸦，使用暖调粉橘渐变，营造如同手账本般的温馨治愈氛围。"
      }
    }
  });
  console.log('Updated profiles:', result);
  process.exit(0);
}

update().catch(console.error);
