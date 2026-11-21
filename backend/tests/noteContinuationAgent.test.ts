import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import Budget from '../models/NoteDiscoveryBudget';
import Discovery from '../models/NoteDiscovery';
import { NoteContinuationAgent } from '../services/noteContinuationAgent';
import { createDiscoveryProvider, type DiscoveryMessage } from '../services/noteDiscoveryProvider';
import { connectNoteDiscoveryTestMongo, noteDiscoveryMongoTestOptions } from './noteDiscoveryTestMongo';
import { fixturePrice, makeCandidate, makeNote, makeRun, nativeToolResponse, ownerId, providerResponse, scriptTransport } from './noteDiscoveryRunnerFixture';

const noResult = { type: 'no_result' };
const toolCall = (name: string, args: unknown, id?: string) => ({ name, arguments: args, id });

test('provider startup refusal avoids transport for missing key and unverified models', async () => {
  const { transport, calls } = scriptTransport();
  for (const price of [{ ...fixturePrice, key: '' }, { ...fixturePrice, model: 'unknown', pricedModel: 'unknown' }]) {
    assert.equal(createDiscoveryProvider(price, transport), null);
  }
  assert.equal(calls.length, 0);
});

test('request bound includes serialized function specs and paired tool history', async () => {
  const { transport, calls } = scriptTransport(providerResponse(noResult), providerResponse({ reply: '继续。' }));
  const provider = createDiscoveryProvider(fixturePrice, transport)!;
  const messages: DiscoveryMessage[] = [{ role: 'user', content: '回看这两次记录。' }];
  const tools = [{ name: 'listOwnFeedback', description: '读取已经保存的反馈。', parameters: { type: 'object' } }];
  const withHistory = provider.prepare([...messages, {
    role: 'assistant', content: null, tool_calls: [{ id: 'call_feedback', type: 'function', function: { name: tools[0].name, arguments: '{}' } }],
  }, { role: 'tool', tool_call_id: 'call_feedback', content: '{"ok":true,"data":{"items":[]}}' }], 900, { tools, toolChoice: 'none' });
  const textOnly = provider.prepare(messages, 900);
  await withHistory.send(new AbortController().signal);
  await textOnly.send(new AbortController().signal);
  for (const [index, prepared] of [withHistory, textOnly].entries()) {
    const { body } = calls[index];
    const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    assert.equal(prepared.maxInputTokens, bytes + 256 + body.messages.length * 32);
  }
  assert.deepEqual(calls[0].body.tools, [{ type: 'function', function: tools[0] }]);
  assert.equal('tools' in calls[1].body, false);
  assert.equal('tool_choice' in calls[1].body, false);
  assert.equal(calls[1].body.response_format.type, 'json_object');
});

test('provider rejects unpaired tool history before transport', () => {
  const { transport, calls } = scriptTransport();
  const provider = createDiscoveryProvider(fixturePrice, transport)!;
  const tools = [{ name: 'listOwnFeedback', description: 'Read feedback', parameters: { type: 'object' } }];
  const assistant = { role: 'assistant' as const, content: null, tool_calls: [{
    id: 'call_feedback', type: 'function' as const, function: { name: tools[0].name, arguments: '{}' },
  }] };
  const options = { tools, toolChoice: 'auto' as const };
  assert.throws(() => provider.prepare([assistant], 900, options), /invalid_discovery_tool_transcript/);
  assert.throws(() => provider.prepare([assistant, { role: 'tool', tool_call_id: 'call_foreign', content: '{}' }], 900, options), /invalid_discovery_tool_transcript/);
  assert.throws(() => provider.prepare([{ role: 'tool', tool_call_id: 'call_feedback', content: '{}' }], 900, options), /unpaired_discovery_tool_result/);
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

  test('round-trips native function calls and publishes a current grounded candidate', async () => {
    const fixture = await makeRun();
    const source = await makeNote(fixture.userId);
    const noteId = source._id.toHexString();
    const { transport, calls } = scriptTransport(
      nativeToolResponse([toolCall('readOwnNote', { noteId }, 'call_read'), toolCall('listOwnFeedback', {}, 'call_feedback')]),
      providerResponse({ type: 'finish', candidates: [makeCandidate(noteId)] }),
    );
    const claim = await fixture.store.claimNext();
    assert.equal((await fixture.schedule.authorizeRun(claim!)).status, 'authorized');
    const agent = new NoteContinuationAgent(claim!, { ...fixture, provider: createDiscoveryProvider(fixturePrice, transport)!, telemetry: false });
    assert.equal(await agent.runDiscovery(fixture.userId, fixture.runId, () => fixture.schedule.canPublish(claim!)), 'completed');
    const published = await Discovery.findOne({ runId: fixture.runId, generation: claim!.generation }).lean();
    assert.equal(published?.evidence[0].excerpt, source.contentText);
    assert.equal((await fixture.store.getRun(fixture.userId, fixture.runId))?.usage?.toolCalls, 4);
    assert.equal(calls[0].body.messages[1].content?.includes(noteId), true);
    assert.equal(calls[0].body.messages[1].content?.includes(source.contentText!), false);
    assert.equal(calls[0].body.tool_choice, 'auto');
    assert.deepEqual(calls[0].body.tools?.map(tool => [tool.type, tool.function.name]), [
      ['function', 'listRecentNotes'], ['function', 'searchOwnNotes'], ['function', 'readOwnNote'], ['function', 'listOwnFeedback'],
    ]);
    assert.deepEqual(calls[1].body.messages.slice(2, 3), [{ role: 'assistant', content: null, tool_calls: [
      { type: 'function', id: 'call_read', function: { name: 'readOwnNote', arguments: JSON.stringify({ noteId }) } },
      { type: 'function', id: 'call_feedback', function: { name: 'listOwnFeedback', arguments: '{}' } },
    ] }]);
    const toolResults = calls[1].body.messages.slice(3);
    assert.deepEqual(toolResults.map(message => message.role === 'tool' && message.tool_call_id), ['call_read', 'call_feedback']);
    assert.match(toolResults[0].content ?? '', /morning test ran out of water/);
    assert.deepEqual(JSON.parse(toolResults[1].content ?? ''), { ok: true, data: { items: [] } });
    assert.equal(calls[1].body.max_tokens, 3940);
  });

  test('cannot turn a foreign note or injected owner override into evidence', async () => {
    const foreign = await makeNote(ownerId());
    const noteId = foreign._id.toHexString();
    const { transport, calls } = scriptTransport(
      nativeToolResponse([toolCall('readOwnNote', { noteId, userId: foreign.userId.toHexString() }), toolCall('readOwnNote', { noteId })]),
      providerResponse({ type: 'finish', candidates: [makeCandidate(noteId)] }),
    );
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
    assert.equal(await fixture.start(), 'no_result');
    assert.equal(await Discovery.countDocuments({ runId: fixture.runId }), 0);
    const messages = calls[1].body.messages;
    assert.match(messages[messages.length - 2].content ?? '', /invalid_args/);
    assert.deepEqual(JSON.parse(messages[messages.length - 1].content ?? ''), { ok: false, error: 'unavailable' });
    assert.equal(JSON.stringify(messages.slice(-2)).includes(foreign.contentText!), false);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'no_result');
  });

  test('rejects an entire batch with an unknown tool, including an otherwise valid read', async () => {
    let noteId = '';
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, async () => nativeToolResponse([
      toolCall('readOwnNote', { noteId }), toolCall('submitCandidate', { candidate: makeCandidate(noteId) }),
    ]))! });
    noteId = fixture.note._id.toHexString();
    await assert.rejects(fixture.start(), { message: 'provider_failed' });
    const usage = fixture.agent.getUsage();
    assert.equal(usage.modelCalls, 1);
    assert.equal(usage.toolCalls, 1);
    assert.equal(usage.notesRead, 0);
    assert.equal(await Discovery.countDocuments({ runId: fixture.runId }), 0);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'failed');
  });

  test('rejects malformed tool envelopes and tool requests embedded in text', async () => {
    const invalidArgs = nativeToolResponse([toolCall('listOwnFeedback', {})]);
    invalidArgs.data.choices[0].message.tool_calls[0].function.arguments = '{malformed';
    const invalidId = nativeToolResponse([toolCall('listOwnFeedback', {}, 'unknowable id')]);
    const duplicateIds = nativeToolResponse([
      toolCall('listOwnFeedback', {}, 'call_dupe'), toolCall('listOwnFeedback', {}, 'call_dupe'),
    ]);
    const wrongRole = nativeToolResponse([toolCall('listOwnFeedback', {})]);
    wrongRole.data.choices[0].message.role = 'user';
    const markup = providerResponse(noResult);
    markup.data.choices[0].message.content = '<｜｜DSML｜｜ invoke name="listOwnFeedback">';
    for (const response of [invalidArgs, invalidId, duplicateIds, wrongRole,
      nativeToolResponse([toolCall('listOwnFeedback', null)]),
      providerResponse({ type: 'tools', calls: [toolCall('listOwnFeedback', {})] }),
      markup,
    ]) {
      const { calls, transport } = scriptTransport(response);
      const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
      await assert.rejects(fixture.start(), { message: 'provider_failed' });
      assert.equal(calls.length, 1);
      assert.equal(fixture.agent.getUsage().toolCalls, 1);
      await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'failed');
    }
  });

  test('rejects a call ID replayed in a later provider turn', async () => {
    const response = nativeToolResponse([toolCall('listOwnFeedback', {}, 'call_replay')]);
    const { calls, transport } = scriptTransport(response, response);
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
    await assert.rejects(fixture.start(), { message: 'provider_failed' });
    assert.equal(calls.length, 2);
    assert.equal(fixture.agent.getUsage().toolCalls, 2);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'failed');
  });

  test('valid no-result costs one request and never retries', async () => {
    const { transport, calls } = scriptTransport(providerResponse(noResult));
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
    assert.equal(await fixture.start(), 'no_result');
    assert.equal(calls.length, 1);
    assert.equal((await fixture.store.getRun(fixture.userId, fixture.runId))?.retryCount, 0);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'no_result');
  });

  test('treats a model finish with no candidates as abstention without a retry', async () => {
    const { transport, calls } = scriptTransport(providerResponse({ type: 'finish', candidates: [] }));
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)!, limits: { maxModelCalls: 1 } });
    assert.equal(await fixture.start(), 'no_result');
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.messages[0].content ?? '', /final model turn.*Do not request tools/);
    assert.equal(calls[0].body.tool_choice, 'none');
    assert.equal(await Discovery.countDocuments({ runId: fixture.runId }), 0);
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
    const { transport, calls } = scriptTransport(nativeToolResponse([toolCall('listOwnFeedback', {})], {
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
    const responses = Array.from({ length: 3 }, () => nativeToolResponse([toolCall('listOwnFeedback', {})]));
    const { transport, calls } = scriptTransport(...responses);
    const fixture = await arrange({ provider: createDiscoveryProvider(fixturePrice, transport)! });
    await assert.rejects(fixture.start(), { message: 'provider_failed' });
    assert.equal(calls.length, 3);
    assert.equal(calls[2].body.tool_choice, 'none');
    assert.equal(fixture.agent.getUsage().toolCalls, 3);
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
      return nativeToolResponse([toolCall('readOwnNote', { noteId })]);
    })! });
    const source = await makeNote(fixture.userId, '河'.repeat(9000));
    noteId = source._id.toHexString();
    await assert.rejects(fixture.start(), { message: 'limit_exceeded' });
    assert.equal(calls.length, 1);
    await fixture.store.finish(fixture.runId, fixture.claim.leaseToken, 'failed');
  });

  test('tool execution counts initial metadata and refuses to exceed eight calls', async () => {
    const { calls, transport } = scriptTransport(nativeToolResponse(Array.from({ length: 8 }, () => toolCall('listOwnFeedback', {}))));
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
        assert.match(messages[messages.length - 1].content ?? '', /note_limit/);
        return providerResponse(noResult);
      }
      return nativeToolResponse(noteIds.map(noteId => toolCall('readOwnNote', { noteId })));
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
    let calls = 0;
    const fixture = await arrange({
      limits: { timeoutMs: 250 },
      provider: createDiscoveryProvider(fixturePrice, ({ signal }) => new Promise((_, reject) => {
        calls++;
        signal.addEventListener('abort', () => { sawAbort = true; reject(new Error('aborted')); }, { once: true });
      }))!,
    });
    await assert.rejects(fixture.start(), { message: 'usage_unknown' });
    assert.equal(sawAbort, true);
    assert.equal(calls, 1);
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
