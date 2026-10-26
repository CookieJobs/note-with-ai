import assert from 'node:assert/strict';
import { test } from 'node:test';
import UserNoteTopicIndex, { TOPIC_INDEX_STATUSES } from '../models/UserNoteTopicIndex';

test('索引模型具有用户-笔记唯一键和明确状态', () => {
  const indexes = UserNoteTopicIndex.schema.indexes();
  assert.ok(indexes.some(([keys, options]) =>
    keys.userId === 1 && keys.noteId === 1 && options.unique === true
  ));
  assert.deepEqual(TOPIC_INDEX_STATUSES, ['pending', 'processing', 'ready', 'failed']);
  assert.equal(UserNoteTopicIndex.schema.path('sourceRevision')?.options.required, true);
  assert.equal(UserNoteTopicIndex.schema.path('sourceFingerprint')?.options.required, true);
  assert.equal(UserNoteTopicIndex.schema.path('automaticAttemptCount')?.options.default, 0);
  assert.ok(UserNoteTopicIndex.schema.path('manualAttemptTimestamps'));
  assert.ok(UserNoteTopicIndex.schema.path('leaseUntil'));
  assert.ok(UserNoteTopicIndex.schema.path('claimToken'));
  assert.ok(UserNoteTopicIndex.schema.path('retryMode'));
  assert.ok(UserNoteTopicIndex.schema.path('nextAttemptAt'));
  assert.ok(UserNoteTopicIndex.schema.path('lastSuccess'));
});
