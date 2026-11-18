import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Types } from 'mongoose';
import AiUsageEvent from '../models/AiUsageEvent';
import NoteDiscovery from '../models/NoteDiscovery';
import NoteDiscoveryRun from '../models/NoteDiscoveryRun';
import NoteDiscoveryPreference from '../models/NoteDiscoveryPreference';

const userId = new Types.ObjectId();
const noteId = new Types.ObjectId();
const run = {
  userId,
  idempotencyKey: 'note-change-12',
  watermark: { changedAt: new Date('2026-11-17T08:00:00Z'), noteId, revision: 12 },
};
const discovery = {
  userId,
  runId: new Types.ObjectId(),
  generation: 1,
  kind: 'next_step',
  title: 'Plan a small trial',
  observation: 'One recorded option supports a trial with one participant.',
  whyNow: 'The latest note identified the first participant.',
  evidence: [{
    noteId, revision: 12, title: 'Trial notes', noteDate: new Date('2026-11-16T08:00:00Z'),
    excerpt: 'one participant', locator: { start: 0, end: 15 }, hasImages: false,
  }],
  sourceFingerprint: 'source-12',
  observationFingerprint: 'observation-1',
  qualification: 'Scope comes from readable note text.',
  suggestedAction: 'Review a trial checklist.',
  quality: {
    passed: true,
    rationale: {
      novelInsight: 'Connect the named participant to a concrete trial.',
      counterEvidence: 'No commitment from that person is recorded.',
      missingInformation: ['Whether the participant is available'],
    },
  },
};

test('run indexes fence active work and deduplicate idempotency keys per account', () => {
  const indexes = NoteDiscoveryRun.schema.indexes();
  assert.ok(indexes.some(([keys, options]) =>
    JSON.stringify(keys) === '{"userId":1,"idempotencyKey":1}' && options.unique === true));
  assert.ok(indexes.some(([keys, options]) =>
    JSON.stringify(keys) === '{"userId":1}'
      && options.unique === true
      && JSON.stringify(options.partialFilterExpression) === '{"status":{"$in":["queued","running"]}}'));
  assert.ok(indexes.some(([keys]) => keys.status === 1 && keys.leaseUntil === 1));

  const document = new NoteDiscoveryRun(run);
  assert.equal(document.validateSync(), undefined);
  assert.equal(document.status, 'queued');
  assert.equal(document.generation, 0);
  assert.equal(new NoteDiscoveryRun({ ...run, status: 'provider_started' }).validateSync()?.errors.status.kind, 'enum');
  assert.equal(new NoteDiscoveryRun({ ...run, generation: 1.5 }).validateSync()?.errors.generation.kind, 'user defined');
});

test('each discovery record requires its account owner', () => {
  assert.equal(new NoteDiscoveryRun({ ...run, userId: undefined }).validateSync()?.errors.userId.kind, 'required');
  assert.equal(new NoteDiscovery({ ...discovery, userId: undefined }).validateSync()?.errors.userId.kind, 'required');
  assert.equal(new NoteDiscoveryPreference().validateSync()?.errors.userId.kind, 'required');
  assert.ok(NoteDiscoveryPreference.schema.indexes().some(([keys, options]) => keys.userId === 1 && options.unique));
});

test('discovery persists supplied evidence with a valid note revision and text location', () => {
  const document = new NoteDiscovery(discovery);
  assert.equal(document.validateSync(), undefined);
  assert.equal(document.status, 'ready');
  assert.equal(new NoteDiscovery({ ...discovery, kind: 'general_tip' }).validateSync()?.errors.kind.kind, 'enum');
  assert.equal(new NoteDiscovery({ ...discovery, evidence: [] }).validateSync()?.errors.evidence.kind, 'user defined');
  assert.ok(new NoteDiscovery({
    ...discovery,
    evidence: [{ ...discovery.evidence[0], revision: 0, locator: { start: 15, end: 0 } }],
  }).validateSync()?.errors['evidence.0.revision']);
  assert.ok(new NoteDiscovery({
    ...discovery,
    evidence: [{ ...discovery.evidence[0], locator: { start: 15, end: 0 } }],
  }).validateSync()?.errors['evidence.0.locator.end']);
  assert.ok(NoteDiscovery.schema.indexes().some(([keys, options]) =>
    keys.userId === 1 && keys.runId === 1 && keys.generation === 1 && keys.observationFingerprint === 1 && options.unique));
});

test('discovery preference defaults to automatic and stores revocable, expiring feedback', () => {
  const document = new NoteDiscoveryPreference({ userId });
  assert.equal(document.validateSync(), undefined);
  assert.equal(document.automaticEnabled, true);
  assert.equal(document.timeZone, 'Asia/Shanghai');
  assert.equal(new NoteDiscoveryPreference({ userId, timeZone: 'Mars/Olympus' }).validateSync()?.errors.timeZone.kind, 'user defined');
  const feedback = {
    kind: 'not_interested',
    discoveryId: new Types.ObjectId(),
    sourceIds: [noteId],
    sourceFingerprint: 'source-12',
    observationFingerprint: 'observation-1',
    createdAt: new Date('2026-11-17T08:00:00Z'),
    expiresAt: new Date('2026-12-17T08:00:00Z'),
    revokedAt: new Date('2026-11-18T08:00:00Z'),
  };
  const withFeedback = new NoteDiscoveryPreference({ userId, automaticEnabled: false, feedback: [feedback] });
  assert.equal(withFeedback.validateSync(), undefined);
  assert.equal(withFeedback.automaticEnabled, false);
  assert.deepEqual(withFeedback.feedback[0].revokedAt, feedback.revokedAt);
  assert.equal(new NoteDiscoveryPreference({
    userId, feedback: [{ ...feedback, kind: 'infer_personality' }],
  }).validateSync()?.errors['feedback.0.kind'].kind, 'enum');
});

test('existing AI usage records accept the note continuation operation', () => {
  const timestamp = new Date();
  const event = new AiUsageEvent({
    requestId: 'discovery-call',
    userId,
    provider: 'deepseek',
    model: 'deepseek-chat',
    operation: 'note_continuation',
    status: 'succeeded',
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: 0,
    inputTokens: 200,
    outputTokens: 20,
    totalTokens: 220,
    estimatedCostMicros: 20,
  });
  assert.equal(event.validateSync(), undefined);
  assert.equal(event.currency, 'CNY');
});
