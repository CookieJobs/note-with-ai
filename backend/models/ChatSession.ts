// backend/models/ChatSession.ts
import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true },
});

const chatSessionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  messages: [messageSchema],
  createdAt: { type: Date, default: Date.now },
});

export const ChatSession = mongoose.model('ChatSession', chatSessionSchema);
