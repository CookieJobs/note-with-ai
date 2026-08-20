import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Note } from '../models/Note';
import { logger } from '../utils/logger';

export interface RevisionBackfillModel {
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Promise<{ matchedCount: number; modifiedCount: number }>;
}

export async function backfillNoteRevisions(model: RevisionBackfillModel): Promise<{
  matchedCount: number;
  modifiedCount: number;
}> {
  return model.updateMany(
    {
      $expr: {
        $let: {
          vars: {
            revisionType: { $type: '$revision' },
            revisionNumber: {
              $convert: {
                input: '$revision',
                to: 'double',
                onError: null,
                onNull: null,
              },
            },
          },
          in: {
            $or: [
              { $not: [{ $in: ['$$revisionType', ['double', 'int', 'long', 'decimal']] }] },
              { $eq: ['$$revisionNumber', null] },
              { $lt: ['$$revisionNumber', 1] },
              { $ne: ['$$revisionNumber', { $trunc: '$$revisionNumber' }] },
            ],
          },
        },
      },
    },
    { $set: { revision: 1 } },
    { timestamps: false },
  );
}

async function main(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
  await mongoose.connect(uri);
  try {
    const result = await backfillNoteRevisions(Note as unknown as RevisionBackfillModel);
    logger.info('Note revision backfill complete', result);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('Note revision backfill failed', error);
    process.exitCode = 1;
  });
}
