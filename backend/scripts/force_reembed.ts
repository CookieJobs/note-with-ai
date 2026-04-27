import mongoose from 'mongoose';
import { Note } from '../models/Note';
import { getCachedQwenEmbedding } from '../utils/embedding';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';
dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai');
  const userId = '688f662ea738058204aa83ae'; // The user we are helping
  const notes = await Note.find({ userId });
  logger.info(`Found ${notes.length} notes. Starting re-embedding...`);
  
  let count = 0;
  for (const note of notes) {
    const text = String((note as any).contentText || note.content || '').trim();
    if (!text) continue;
    try {
      const embedding = await getCachedQwenEmbedding(text, 1024);
      if (embedding && embedding.length === 1024) {
        await Note.updateOne({ _id: note._id }, { $set: { embedding } });
        count++;
        if (count % 10 === 0) logger.info(`Re-embedded ${count} notes...`);
      }
    } catch (e) {
      logger.error(`Error on note ${note._id}:`, e);
    }
  }
  logger.info(`Finished re-embedding ${count} notes.`);
  process.exit(0);
};
run();
