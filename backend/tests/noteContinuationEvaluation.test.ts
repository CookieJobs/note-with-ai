import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Note } from '../models/Note';
import Discovery from '../models/NoteDiscovery';
import { NoteContinuationAgent } from '../services/noteContinuationAgent';
import { createDiscoveryProvider } from '../services/noteDiscoveryProvider';
import { evaluationCases } from './fixtures/noteContinuation/cases';
import { fixturePrice, makeCandidate, makeNote, makeRun, nativeToolResponse, ownerId, providerResponse } from './noteDiscoveryRunnerFixture';
import { connectNoteDiscoveryTestMongo, noteDiscoveryMongoTestOptions } from './noteDiscoveryTestMongo';

test('fixed corpus contains four positives per kind and all twelve negative categories', () => {
  assert.equal(evaluationCases.length, 24);
  assert.equal(new Set(evaluationCases.map(c => c.id)).size, 24);
  for (const kind of ['connection', 'follow_up', 'next_step']) {
    assert.equal(evaluationCases.filter(c => c.kind === kind && c.expectation === 'useful').length, 4);
  }
  assert.equal(evaluationCases.filter(c => c.expectation === 'abstain').length, 12);
});

describe('synthetic corpus through production runner (contracts only, not semantic quality)', noteDiscoveryMongoTestOptions, () => {
  let cleanup: () => Promise<void>;
  before(async () => { cleanup = await connectNoteDiscoveryTestMongo('worker'); });
  after(async () => { await cleanup?.(); });
  for (const item of evaluationCases) test(item.id, async () => {
    const fixture = await makeRun();
    const notes = await Promise.all(item.notes.map((text, index) => makeNote(
      item.attack === 'foreign' ? ownerId() : fixture.userId, text, new Date(Date.UTC(2026, 0, index + 1)),
    )));
    if (item.attack === 'foreign') await makeNote(fixture.userId, '可见的合成账户笔记，仅用于初始化。');
    let calls = 0;
    let observedForeignBody = false;
    const candidate = makeCandidate(String(notes[0]._id), item.notes[0]);
    candidate.kind = item.kind;
    candidate.relationshipKey = item.id;
    candidate.questionKey = item.id;
    candidate.evidence = notes.map((note, index) => ({ noteId: String(note._id), revision: 1, excerpt: item.notes[index] }));
    const provider = createDiscoveryProvider(fixturePrice, async request => {
      if (item.attack === 'foreign' && JSON.stringify(request.body.messages).includes(item.notes[0])) observedForeignBody = true;
      calls++;
      if (item.attack === 'fault') throw new Error('synthetic transport failure');
      // Semantic negatives deliberately script abstention: this verifies execution, not model judgement.
      if (item.expectation === 'abstain' && !item.attack) return providerResponse({ type: 'no_result' });
      if (calls === 1) return nativeToolResponse(notes.map(note => ({
        name: 'readOwnNote', arguments: { noteId: String(note._id) },
      })));
      if (item.attack === 'revision') await Note.updateOne({ _id: notes[0]._id }, { $set: { revision: 2 } });
      if (item.attack === 'deleted') await Note.deleteOne({ _id: notes[0]._id });
      return providerResponse({ type: 'finish', candidates: item.attack === 'duplicate' ? [candidate, candidate] : [candidate] });
    })!;
    if (item.attack === 'budget') fixture.budget.reserve = async () => null;
    const claim = await fixture.store.claimNext();
    assert.ok(claim);
    assert.equal((await fixture.schedule.authorizeRun(claim)).status, 'authorized');
    const agent = new NoteContinuationAgent(claim, { ...fixture, provider, telemetry: false });
    const start = () => agent.runDiscovery(fixture.userId, fixture.runId, () => fixture.schedule.canPublish(claim));
    if (item.attack === 'fault' || item.attack === 'budget') {
      await assert.rejects(start(), { message: item.attack === 'fault' ? 'usage_unknown' : 'budget_exhausted' });
      assert.equal(calls, item.attack === 'fault' ? 1 : 0);
      await fixture.store.finish(fixture.runId, claim.leaseToken, 'failed');
    } else {
      const outcome = await start();
      assert.equal(outcome, item.expectation === 'useful' || item.attack === 'duplicate' ? 'completed' : 'no_result');
      if (outcome !== 'completed') await fixture.store.finish(fixture.runId, claim.leaseToken, outcome);
    }
    if (item.attack === 'foreign') {
      assert.equal(calls, 2, 'Foreign read must be attempted rather than skipped due to empty recent notes');
      assert.equal(observedForeignBody, false);
    }
    const records = await Discovery.find({ runId: fixture.runId }).lean();
    assert.equal(records.length, item.expectation === 'useful' || item.attack === 'duplicate' ? 1 : 0);
    for (const record of records) for (const evidence of record.evidence) {
      const source = await Note.findOne({ _id: evidence.noteId, userId: fixture.userId }).lean();
      assert.ok(source);
      assert.equal(source.revision, evidence.revision);
      assert.equal(source.contentText!.slice(evidence.locator!.start, evidence.locator!.end), evidence.excerpt);
    }
    assert.ok(agent.getUsage().modelCalls <= 3);
    assert.ok(agent.getUsage().toolCalls <= 8);
    assert.ok(agent.getUsage().notesRead <= 12);
  });
});

test('all twelve positive templates reject a violated kind-specific quality gate', async () => {
  const { validateCandidate } = await import('../services/noteDiscoveryService');
  for (const item of evaluationCases.filter(value => value.expectation === 'useful')) {
    const candidate = makeCandidate('000000000000000000000001', item.notes[0]);
    candidate.kind = item.kind;
    candidate.evidence = item.notes.map((excerpt, index) => ({
      noteId: `00000000000000000000000${index + 1}`, revision: 1, excerpt,
    }));
    const evidence = candidate.evidence.map((row, index) => ({ ...row, title: '', hasImages: false,
      noteDate: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), locator: { start: 0, end: row.excerpt.length },
    }));
    if (item.kind === 'next_step') delete candidate.draft;
    // connection deliberately lacks relationshipKey; follow_up deliberately lacks questionKey.
    const result = await validateCandidate(candidate, evidence);
    assert.equal(result.passed, false, item.id);
    assert.equal(result.reason, item.kind === 'connection' ? 'relationship_required'
      : item.kind === 'follow_up' ? 'ordered_follow_up_required' : 'draft_and_open_questions_required');
  }
});
