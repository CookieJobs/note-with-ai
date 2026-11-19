import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import Budget from '../models/NoteDiscoveryBudget';
import Discovery from '../models/NoteDiscovery';
import { NoteContinuationAgent } from '../services/noteContinuationAgent';
import { createDiscoveryProvider } from '../services/noteDiscoveryProvider';
import { connectNoteDiscoveryTestMongo, noteDiscoveryMongoTestOptions } from './noteDiscoveryTestMongo';
import { fixturePrice, makeCandidate, makeNote, makeRun, ownerId, providerResponse, scriptTransport } from './noteDiscoveryRunnerFixture';

const noResult = { type: 'no_result' };
const toolAction = (name: string, args: unknown) => ({ type: 'tools', calls: [{ name, arguments: args }] });

test('provider startup refusal avoids transport for missing key and unverified models', async () => {
  const { transport, calls } = scriptTransport();
  for (const price of [{ ...fixturePrice, key: '' }, { ...fixturePrice, model: 'unknown', pricedModel: 'unknown' }]) {
    assert.equal(createDiscoveryProvider(price, transport), null);
  }
  assert.equal(calls.length, 0);
});

describe('note continuation agent', noteDiscoveryMongoTestOptions, () => {
  let cleanup: () => Promise<void>;
  before(async () => { cleanup = await connectNoteDiscoveryTestMongo('worker'); });
  after(async () => { await cleanup?.(); });

  async function arrange(options: ConstructorParameters<typeof NoteContinuationAgent>[1] = {}) {
    const fixture = await makeRun();
    const note = await makeNote(fixture.userId);
    const claim = await fixture.store.claimNext();
    assert.equal(claim?._id.toHexString(), fixture.runId);
    assert.equal((await fixture.schedule.authorizeRun(claim!)).status, 'authorized');
    const agent = new NoteContinuationAgent(claim!, { ...fixture, telemetry: false, ...options });
    return { ...fixture, agent, note, claim: claim!, start: () => agent.runDiscovery(fixture.userId, fixture.runId, () => fixture.schedule.canPublish(claim!)) };
  }

  test('seeds recent metadata, reads owned source and publishes a current grounded candidate', async () => {
    const fixture = await makeRun();
    const source = await makeNote(fixture.userId);
    const noteId = source._id.toHexString();
    const { transport, calls } = scriptTransport(
      providerResponse(toolAction('readOwnNote', { noteId })),
      providerResponse({ type: 'finish', candidates: [makeCandidate(noteId)] }),
    );
    const claim = await fixture.store.claimNext();
    assert.equal((await fixture.schedule.authorizeRun(claim!)).status, 'authorized');
    const agent = new NoteContinuationAgent(claim!, { ...fixture, provider: createDiscoveryProvider(fixturePrice, transport)!, telemetry: false });
    assert.equal(await agent.runDiscovery(fixture.userId, fixture.runId, () => fixture.schedule.canPublish(claim!)), 'completed');
    const published = await Discovery.findOne({ runId: fixture.runId, generation: claim!.generation }).lean();
    assert.equal(published?.evidence[0].excerpt, source.contentText);
    assert.equal((await fixture.store.getRun(fixture.userId, fixture.runId))?.usage?.toolCalls, 3);
    assert.equal(calls[0].body.messages[1].content.includes(noteId), true);
    assert.equal(calls[0].body.messages[1].content.includes(source.contentText!), false);
    assert.equal(calls[1].body.max_tokens, 3940);
  });

  test('cannot turn a foreign note or injected owner override into evidence', async () => {
    const foreign = await makeNote(ownerId());
    const noteId = foreign._id.toHexString();
    const { transport, calls } = scriptTransport(
      providerResponse(toolAction('readOwnNote', { noteId, userId: foreign.userId.toHexString() })),
      providerResponse({ type: 'finish', candidates: [makeCandidate(noteId)] }),
    );
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
    assert.equal(await fixture.start(), 'no_result');
    assert.equal(await Discovery.countDocuments({ runId: fixture.runId }), 0);
    const messages = calls[1].body.messages;
    const toolResult = messages[messages.length - 1].content;
    assert.match(toolResult, /invalid_args/);
    assert.equal(toolResult.includes(foreign.contentText!), false);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'no_result');
  });

  test('valid no-result costs one request and never retries', async () => {
    const { transport, calls } = scriptTransport(providerResponse(noResult));
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
    assert.equal(await fixture.start(), 'no_result');
    assert.equal(calls.length, 1);
    assert.equal((await fixture.store.getRun(fixture.userId, fixture.runId))?.retryCount, 0);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'no_result');
  });

  test('settles retryable response with known usage and reserves independently for its single retry', async () => {
    const data = { usage: { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 } };
    const { transport, calls } = scriptTransport({ status: 503, data }, providerResponse(noResult));
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
    assert.equal(await fixture.start(), 'no_result');
    const rows = await Budget.find({ 'reservations.runId': fixture.runId }).lean();
    const reservations = rows.flatMap(row => row.reservations).filter(row => String(row.runId) === fixture.runId);
    assert.equal(reservations.length, 2);
    assert.deepEqual(reservations.map(row => row.delivery), ['response_received', 'response_received']);
    assert.equal(new Set(reservations.map(row => row.id)).size, 2);
    assert.equal(calls[1].body.max_tokens, 3990);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'no_result');
  });

  test('unknown delivery charges full reservation and persistently blocks independent dispatch and retry', async () => {
    let count = 0;
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, async () => {
      count++;
      throw new Error('fixture-only private body and key');
    })! });
    await assert.rejects(fixture.start(), { message: 'usage_unknown' });
    const row = await fixture.store.getRun(fixture.userId, fixture.runId);
    assert.equal(count, 1);
    assert.equal(row?.providerDeliveryUnknown, true);
    assert.equal(row?.retryCount, 0);
    const ledger = await Budget.findOne({ 'reservations.runId': fixture.runId }).lean();
    const reservation = ledger?.reservations.find(item => String(item.runId) === fixture.runId);
    assert.equal(reservation?.delivery, 'delivery_unknown');
    assert.equal(reservation?.state, 'settled');
    assert.equal(reservation?.settledMicros, reservation?.reservedMicros);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'failed', { failureCategory: 'usage_unknown' });
  });

  test('absent or inconsistent billing usage settles fully without a second model dispatch', async () => {
    const { transport, calls } = scriptTransport(providerResponse(toolAction('listOwnFeedback', {}), {
      prompt_tokens: 100, completion_tokens: 60, total_tokens: 0,
    }));
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
    await assert.rejects(fixture.start(), { message: 'limit_exceeded' });
    const ledger = await Budget.findOne({ 'reservations.runId': fixture.runId }).lean();
    const reservation = ledger?.reservations.find(item => String(item.runId) === fixture.runId);
    assert.equal(calls.length, 1);
    assert.equal(reservation?.delivery, 'response_received');
    assert.equal(reservation?.settledMicros, reservation?.reservedMicros);
    assert.equal(fixture.agent.getUsage().inputTokens, null);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'failed');
  });

  test('stops at the third model request, including repeated tool plans', async () => {
    const response = providerResponse(toolAction('listOwnFeedback', {}));
    const { transport, calls } = scriptTransport(response, response, response);
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
    await assert.rejects(fixture.start(), { message: 'limit_exceeded' });
    assert.equal(calls.length, 3);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'failed');
  });

  test('a reported output above the dispatch envelope prevents publication and further calls', async () => {
    const { transport, calls } = scriptTransport(providerResponse(noResult, {
      prompt_tokens: 100, completion_tokens: 4001, total_tokens: 4101,
    }));
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
    await assert.rejects(fixture.start(), { message: 'limit_exceeded' });
    assert.equal(calls.length, 1);
    assert.equal(await Discovery.countDocuments({ runId: fixture.runId }), 0);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'failed');
  });

  test('overlarge multibyte read cannot enter cumulative model input', async () => {
    const { calls, transport } = scriptTransport();
    let noteId = '';
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, async request => {
      calls.push(request);
      return providerResponse(toolAction('readOwnNote', { noteId }));
    })! });
    const source = await makeNote(fixture.userId, '河'.repeat(9000));
    noteId = source._id.toHexString();
    await assert.rejects(fixture.start(), { message: 'limit_exceeded' });
    assert.equal(calls.length, 1);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'failed');
  });

  test('tool execution counts initial metadata and refuses to exceed eight calls', async () => {
    const { calls, transport } = scriptTransport(providerResponse({
      type: 'tools',
      calls: Array.from({ length: 8 }, () => ({ name: 'listOwnFeedback', arguments: {} })),
    }));
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
    await assert.rejects(fixture.start(), { message: 'limit_exceeded' });
    assert.equal(fixture.agent.getUsage().toolCalls, 8);
    assert.equal(calls.length, 1);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'failed');
  });

  test('number of distinct full reads obeys the configured cap', async () => {
    const requests: Parameters<typeof createDiscoveryProvider>[1] = async request => {
      if (request.body.messages.length > 2) {
        const messages = request.body.messages;
        assert.match(messages[messages.length - 1].content, /note_limit/);
        return providerResponse(noResult);
      }
      return providerResponse({
        type: 'tools',
        calls: noteIds.map(noteId => ({ name: 'readOwnNote', arguments: { noteId } })),
      });
    };
    const noteIds: string[] = [];
    const fixture = await arrange({
      provider: createDiscoveryProvider(fixturePrice, requests)!, limits: { maxNotesRead: 1 },
    });
    noteIds.push(fixture.note._id.toHexString(), (await makeNote(fixture.userId))._id.toHexString());
    assert.equal(await fixture.start(), 'no_result');
    assert.equal(fixture.agent.getUsage().notesRead, 1);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'no_result');
  });

  test('shared wall-clock timeout aborts a waiting transport and settles unknown delivery', async () => {
    let sawAbort = false;
    const fixture = await arrange({
      limits: { timeoutMs: 250 },
      provider: createDiscoveryProvider(fixturePrice, ({ signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => { sawAbort = true; reject(new Error('aborted')); }, { once: true });
      }))!,
    });
    await assert.rejects(fixture.start(), { message: 'usage_unknown' });
    assert.equal(sawAbort, true);
    assert.equal((await fixture.store.getRun(fixture.userId, fixture.runId))?.providerDeliveryUnknown, true);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'failed', { failureCategory: 'usage_unknown' });
  });

  test('a lost boundary prevents any later tool or publication and never spends another request', async () => {
    let enabled = true;
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, async () => {
      enabled = false;
      return providerResponse({ type: 'finish', candidates: [] });
    })! });
    assert.equal(await fixture.agent.runDiscovery(fixture.userId, fixture.runId, async () => enabled), 'cancelled');
    assert.equal(fixture.agent.getUsage().toolCalls, 1);
    assert.equal(fixture.agent.getUsage().modelCalls, 1);
    assert.equal(await Discovery.countDocuments({ runId: fixture.runId }), 0);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'cancelled');
  });
});
