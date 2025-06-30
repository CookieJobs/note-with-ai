// backend/models/ChatSession.ts
import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true }
});

const ChatSessionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    title: { type: String, required: true },
    messages: [MessageSchema],
  },
  { timestamps: true }
);

export default mongoose.model('ChatSession', ChatSessionSchema);
