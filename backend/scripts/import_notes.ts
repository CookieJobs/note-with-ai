import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Note } from '../models/Note';
import User from '../models/User';
import { logger } from '../utils/logger';

// Load env vars
dotenv.config();

const TARGET_USERNAME = 'liujin';
const HTML_FILE_PATH = '/Users/liujin/Documents/noteWithAI/我的记忆宫殿的笔记.html';

async function connectDB() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
  try {
    await mongoose.connect(MONGODB_URI);
    logger.info('✅ Connected to MongoDB');
  } catch (error) {
    logger.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function importNotes() {
  await connectDB();

  try {
    // 1. Find User
    const user = await User.findOne({ username: TARGET_USERNAME });
    if (!user) {
      logger.error(`❌ User '${TARGET_USERNAME}' not found! Aborting.`);
      process.exit(1);
    }
    logger.info(`✅ Found user: ${user.username} (${user._id})`);

    // 2. Read File
    if (!fs.existsSync(HTML_FILE_PATH)) {
      logger.error(`❌ File not found: ${HTML_FILE_PATH}`);
      process.exit(1);
    }
    const htmlContent = fs.readFileSync(HTML_FILE_PATH, 'utf-8');
    const $ = cheerio.load(htmlContent);

    const memos = $('.memo');
    logger.info(`Found ${memos.length} memos to process...`);

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (let i = 0; i < memos.length; i++) {
      const memo = memos[i];
      const timeStr = $(memo).find('.time').text().trim();
      const contentHtml = $(memo).find('.content').html() || '';
      const contentText = $(memo).find('.content').text().trim();

      if (!timeStr || !contentHtml) {
        logger.warn(`⚠️ Skipping memo index ${i}: Missing time or content`);
        failCount++;
        continue;
      }

      const createdAt = new Date(timeStr);
      if (isNaN(createdAt.getTime())) {
        logger.warn(`⚠️ Skipping memo index ${i}: Invalid date format '${timeStr}'`);
        failCount++;
        continue;
      }

      // Check for duplicates (same user, same created time)
      const existing = await Note.findOne({
        userId: user._id,
        createdAt: createdAt
      });

      if (existing) {
        skipCount++;
        continue;
      }

      try {
        await Note.create({
          userId: user._id,
          content: contentHtml,
          contentText: contentText,
          createdAt: createdAt,
          updatedAt: createdAt,
          contentJson: null,
          title: '',
          keywords: [],
          concepts: [],
          summary: '',
          embedding: []
        });
        successCount++;
        if (successCount % 50 === 0) {
            logger.info(`Processed ${i + 1}/${memos.length}...`);
        }
      } catch (err) {
        logger.error(`❌ Error importing memo at ${timeStr}:`, err);
        failCount++;
      }
    }

    logger.info('\n🎉 Import Completed!');
    logger.info(`Total: ${memos.length}`);
    logger.info(`✅ Success: ${successCount}`);
    logger.info(`⏭️ Skipped (Duplicate): ${skipCount}`);
    logger.info(`❌ Failed: ${failCount}`);

    logger.info('\n👉 Next Step: Run `npm run repair:embeddings` to generate embeddings for new notes.');

  } catch (error) {
    logger.error('❌ Script failed:', error);
  } finally {
    await mongoose.disconnect();
    logger.info('👋 Disconnected from MongoDB');
  }
}

importNotes();
