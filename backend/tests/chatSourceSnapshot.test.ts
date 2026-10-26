import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-openrouter-key';

describe('chat source snapshot', () => {
  it('keeps old care source link identity without exposing synthetic insertion date', async () => {
    const { chatService } = await import('../services/chatService');
    const noteId = '507f1f77bcf86cd799439011';
    const session = chatService.formatSession({
      _id: 'session',
      relatedNotes: [{ noteId, title: '', matchType: 'care_source', createdAt: new Date('2026-10-13T00:00:00Z') }],
    } as never);
    assert.equal(session.relatedNotes?.[0].noteId, noteId);
    assert.equal(session.relatedNotes?.[0].createdAt, undefined);
  });

  it('retains the verified date on a new care source', async () => {
    const { chatService } = await import('../services/chatService');
    const date = new Date('2026-10-12T16:30:00Z');
    const session = chatService.formatSession({
      _id: 'session',
      relatedNotes: [{ noteId: '507f1f77bcf86cd799439011', title: '', matchType: 'care_source', createdAtSource: 'note', createdAt: date }],
    } as never);
    assert.equal(session.relatedNotes?.[0].createdAt, date);
  });
});
