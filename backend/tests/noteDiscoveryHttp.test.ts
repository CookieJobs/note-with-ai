import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-secret';
process.env.DEEPSEEK_API_KEY ||= 'synthetic-key';
process.env.OPENROUTER_API_KEY ||= 'synthetic-key';
describe('discovery HTTP public entrypoints', () => {
  it('exports production API service and canonical source-safe serializers', async () => {
    const { noteDiscoveryApiService } = await import('../services/noteDiscoveryApiService');
    assert.equal(typeof noteDiscoveryApiService.list, 'function');
    assert.equal(typeof noteDiscoveryApiService.cleanupUser, 'function');
    const { serializeDiscovery } = await import('../types/noteDiscovery');
    assert.equal(typeof serializeDiscovery, 'function');
  });
});

import { before, after, afterEach, mock } from 'node:test';
import { Types } from 'mongoose';
import { connectNoteDiscoveryTestMongo, noteDiscoveryMongoTestOptions } from './noteDiscoveryTestMongo';

describe('discovery HTTP ownership, durable exposure and actions', noteDiscoveryMongoTestOptions, () => {
  let cleanup: () => Promise<void>;
  let server: any;
  let base: string;
  let userId: string;
  let token: string;
  let service: any;
  let item: any;
  let second: any;
  let now = new Date('2026-11-19T16:01:00Z');
  const modules = async () => ({ Note: (await import('../models/Note')).Note, Discovery: (await import('../models/NoteDiscovery')).default,
    Run: (await import('../models/NoteDiscoveryRun')).default, Preference: (await import('../models/NoteDiscoveryPreference')).default });
  async function request(path: string, method = 'GET', body?: unknown, auth = token) {
    const response = await fetch(base + '/api/note-discoveries' + path, { method,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, json: await response.json() as any };
  }
  before(async () => {
    cleanup = await connectNoteDiscoveryTestMongo('worker');
    const { Note, Discovery, Run } = await modules();
    const User = (await import('../models/User')).default;
    userId = new Types.ObjectId().toString();
    await User.collection.insertOne({ _id: new Types.ObjectId(userId), email: 'test@example.invalid', isActive: true });
    token = (await import('../utils/jwt')).generateToken({ userId, username: 'test', email: 'test@example.invalid' });
    const note = await Note.create({ userId, content: '一条已经保存并可核对的正文', contentText: '一条已经保存并可核对的正文', revision: 1 });
    const run = await Run.create({ userId, trigger: 'manual', idempotencyKey: 'published', status: 'completed', generation: 1, watermark: { changedAt: now }, availableAt: now });
    for (let index = 0; index < 6; index++) {
      const created = await Discovery.create({ userId, runId: run._id, generation: 1, kind: 'next_step', title: '继续测试', observation: `具体观察${index}`, whyNow: '现在可以继续', qualification: '仅为建议', suggestedAction: '比较两次记录', draft: '可编辑的草稿',
        evidence: [{ noteId: note._id, revision: 1, title: '原文', noteDate: now, excerpt: '已经保存', hasImages: false }],
        sourceFingerprint: 'source', sourceBodyBaselines: [{ noteId: note._id, fingerprint: 'a'.repeat(64) }], observationFingerprint: `observation${index}`, relationshipKey: 'relation',
        quality: { passed: true, rationale: { novelInsight: '可比较', counterEvidence: '条件可能不同', missingInformation: [] } } });
      if (!index) item = created;
      if (index === 1) second = created;
    }
    const { NoteDiscoveryApiService, noteDiscoveryApiService } = await import('../services/noteDiscoveryApiService');
    const { NoteDiscoveryScheduleService } = await import('../services/noteDiscoveryScheduleService');
    const schedule = new NoteDiscoveryScheduleService({ enabled: true, now: () => now });
    service = new NoteDiscoveryApiService({ enabled: () => true, now: () => now, schedule });
    for (const name of ['list', 'run', 'preferences', 'feedback', 'revokeFeedback', 'session', 'save'] as const) {
      mock.method(noteDiscoveryApiService, name, service[name].bind(service));
    }
    const { createApp } = await import('../index');
    server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { mock.restoreAll(); await new Promise<void>(resolve => server?.close(() => resolve())); await cleanup?.(); });
  it('requires authentication and rejects foreign/unpublished discovery actions without data leakage', async () => {
    assert.equal((await request('', 'GET', undefined, '')).status, 401);
    assert.equal((await request(`/${new Types.ObjectId()}/feedback`, 'POST', { kind: 'not_related' })).status, 404);
    const { Discovery } = await modules();
    await Discovery.updateOne({ _id: item._id }, { $set: { generation: 2 } });
    assert.equal((await request(`/${item.id}/save`, 'POST', { text: '确认', idempotencyKey: 'x' })).status, 409);
    await Discovery.updateOne({ _id: item._id }, { $set: { generation: 1 } });
  });
  it('atomically caps concurrent first exposure at three local-day slots, keeps candidates and permits explicit history', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => request('')));
    assert.ok(results.every(r => r.status === 200));
    const { Discovery } = await modules();
    assert.equal(await Discovery.countDocuments({ userId, exposedAt: { $exists: true } }), 3);
    assert.equal(await Discovery.countDocuments({ userId }), 6);
    assert.equal((await request('?history=true')).json.data.items.length, 6);
    now = new Date('2026-11-20T16:01:00Z');
    await request('');
    assert.equal(await Discovery.countDocuments({ userId, exposedAt: { $exists: true } }), 6);
  });
  it('copies only the original server relation baseline, supports expiry and idempotent undo', async () => {
    const { Preference, Discovery } = await modules();
    const result = await request(`/${item.id}/feedback`, 'POST', { kind: 'not_related', sourceBodyBaselines: [{ fingerprint: 'forged' }] });
    assert.equal(result.status, 200);
    let pref = await Preference.findOne({ userId }).lean();
    assert.equal(pref!.feedback[0].sourceBodyBaselines![0].fingerprint, 'a'.repeat(64));
    assert.equal(JSON.stringify(result.json).includes('fingerprint'), false);
    await request(`/${item.id}/feedback`, 'DELETE');
    await request(`/${item.id}/feedback`, 'DELETE');
    pref = await Preference.findOne({ userId }).lean();
    assert.ok(pref!.feedback[0].revokedAt);
    assert.equal((await Discovery.findById(item.id))!.status, 'ready');
    const uninterested = await request(`/${item.id}/feedback`, 'POST', { kind: 'not_interested' });
    assert.equal(Date.parse(uninterested.json.data.expiresAt) - now.getTime(), 30 * 86400_000);
    await request(`/${item.id}/feedback`, 'DELETE');
  });
  it('returns independent lifecycle states, preserves automatic off and replays one manual run', async () => {
    const off = await request('/preferences', 'PATCH', { automaticEnabled: false });
    assert.equal(off.json.data.automaticEnabled, false);
    const [a, b] = await Promise.all([request('/run', 'POST', { idempotencyKey: 'double' }), request('/run', 'POST', { idempotencyKey: 'double' })]);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.equal(a.json.data.runId, b.json.data.runId);
    assert.equal(a.json.data.status, 'queued');
    assert.equal((await request('')).json.data.run.status, 'queued');
  });
  it('saves only confirmed text once, restores create/reference crash gap and keeps first concurrent confirmation', async () => {
    const { noteWriteModule } = await import('../services/NoteUpdateOrchestrator');
    const scheduler = (noteWriteModule as any).scheduler;
    const stub = mock.method(scheduler, 'schedule', () => undefined);
    const { Note } = await modules();
    const { NoteDiscoveryAction } = await import('../models/NoteDiscoveryAction');
    await NoteDiscoveryAction.init();
    const before = await Note.countDocuments({ userId });
    const [a, b] = await Promise.all([request(`/${item.id}/save`, 'POST', { text: '用户确认 A', idempotencyKey: 'save-a' }), request(`/${item.id}/save`, 'POST', { text: '用户确认 B', idempotencyKey: 'save-b' })]);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.equal(a.json.data.note._id, b.json.data.note._id);
    assert.equal(a.json.data.note.contentText, b.json.data.note.contentText);
    assert.equal(await Note.countDocuments({ userId }), before + 1);
    const action = await NoteDiscoveryAction.findOne({ userId, discoveryId: second._id, kind: 'save' });
    assert.equal(action, null);
    const targetId = new Types.ObjectId();
    await NoteDiscoveryAction.create({ userId, discoveryId: second._id, kind: 'save', targetId, payload: { text: '崩溃前确认文本', title: '继续测试' } });
    await noteWriteModule.create({ userId, stableNoteId: String(targetId), body: { kind: 'plain-text', text: '崩溃前确认文本' }, title: '继续测试' });
    const storedBeforeRepair = (await Note.findById(targetId))!.toObject();
    const scheduledBeforeRepair = stub.mock.callCount();
    const recovered = await request(`/${second.id}/save`, 'POST', { text: '重放新文本', idempotencyKey: 'recover' });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.json.data.note._id, String(targetId));
    assert.equal(recovered.json.data.note.contentText, '崩溃前确认文本');
    assert.deepEqual((await Note.findById(targetId))!.toObject(), storedBeforeRepair);
    assert.equal(stub.mock.callCount(), scheduledBeforeRepair, 'create/reference repair must not reschedule existing note');
    stub.mock.restore();
  });
  it('creates one server-bound continuation session, advances its action and reuses a reference-gap session', async () => {
    const { noteDiscoveryConversationService, NoteDiscoveryConversationService } = await import('../services/noteDiscoveryConversationService');
    const { createDiscoveryProvider } = await import('../services/noteDiscoveryProvider');
    const { fixturePrice, scriptTransport, providerResponse } = await import('./noteDiscoveryRunnerFixture');
    const { NoteDiscoveryBudgetService } = await import('../services/noteDiscoveryBudgetService');
    const Chat = (await import('../models/Chat')).default;
    const { NoteDiscoveryAction } = await import('../models/NoteDiscoveryAction');
    const scripted = scriptTransport(providerResponse({ reply: '先比较记录中两种练习时长，观察条件是否一致。' }));
    const budget = new NoteDiscoveryBudgetService({ enabled: true, userCapMicros: 1_000_000, globalCapMicros: 5_000_000, attemptCapMicros: 250_000 });
    const service = new NoteDiscoveryConversationService({ enabled: () => true, provider: createDiscoveryProvider(fixturePrice, scripted.transport), budget });
    const stub = mock.method(noteDiscoveryConversationService, 'execute', service.execute.bind(service));
    const first = await request(`/${item.id}/session`, 'POST', { sourceMode: 'single_note', selectedSourceIds: [new Types.ObjectId()] });
    assert.equal(first.status, 200);
    assert.equal(first.json.data.session.sourceMode, 'multi_note_discovery');
    assert.ok(first.json.data.session.messages[0].content.includes('请直接推进这个行动'));
    assert.equal(first.json.data.session.messages[1].sourceSnapshots.length, 1);
    const action = await NoteDiscoveryAction.findOne({ userId, discoveryId: item._id, kind: 'session' });
    const { Discovery } = await modules();
    await Discovery.updateOne({ _id: item._id }, { $unset: { sessionId: 1 } });
    const again = await request(`/${item.id}/session`, 'POST');
    assert.equal(again.status, 200);
    assert.equal(again.json.data.session._id, String(action.targetId));
    assert.equal(again.json.data.reused, true);
    assert.equal(scripted.calls.length, 1);
    assert.equal(await Chat.countDocuments({ userId, discoveryId: item._id }), 1);
    stub.mock.restore();
  });
  it('orders feedback from one authoritative record when POST acknowledgement is delayed across DELETE', async () => {
    const { Preference } = await modules();
    const original = Preference.updateOne.bind(Preference);
    let resume!: () => void;
    let reached!: () => void;
    const held = new Promise<void>(resolve => { resume = resolve; });
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const stub = mock.method(Preference, 'updateOne', (async (...args: any[]) => {
      const result = await (original as any)(...args);
      if (Array.isArray(args[1])) { reached(); await held; }
      return result;
    }) as any);
    const post = service.feedback(userId, item.id, 'not_interested');
    await ready;
    await service.revokeFeedback(userId, item.id);
    resume(); await post; stub.mock.restore();
    const visible = await service.list(userId, { history: true });
    assert.equal(visible.items.find((d: any) => d.id === item.id).status, 'ready');
  });
  it('replays completed saves read-only and never recreates a deleted completed target', async () => {
    const { Note } = await modules();
    const { NoteDiscoveryAction } = await import('../models/NoteDiscoveryAction');
    const { noteWriteModule } = await import('../services/NoteUpdateOrchestrator');
    const action = await NoteDiscoveryAction.findOne({ userId, discoveryId: item._id, kind: 'save' });
    assert.ok(action.completedAt);
    const before = (await Note.findOne({ _id: action.targetId, userId }))!.toObject();
    const stub = mock.method(noteWriteModule, 'create', () => { assert.fail('completed save must never re-enter create or schedule enrichment'); });
    const replay = await service.save(userId, item.id, { text: '再次确认', idempotencyKey: 'completed-readonly' });
    assert.equal(replay.note._id, String(action.targetId));
    assert.deepEqual((await Note.findOne({ _id: action.targetId, userId }))!.toObject(), before);
    await Note.deleteOne({ _id: action.targetId, userId });
    await assert.rejects(service.save(userId, item.id, { text: '不要复活', idempotencyKey: 'deleted' }), /已删除/);
    assert.equal(await Note.countDocuments({ _id: action.targetId }), 0);
    stub.mock.restore();
  });
  it('resumes erasure from a marker-only crash and compensates exposure/action/draft writes racing cleanup', async () => {
    const { Note, Discovery, Run, Preference } = await modules();
    const { NoteDiscoveryCleanup } = await import('../models/NoteDiscoveryCleanup');
    const { NoteDiscoveryAction } = await import('../models/NoteDiscoveryAction');
    const { NoteDiscoveryExposure, recoverDiscoveryUserCleanup } = await import('../services/noteDiscoveryApiService');
    const { NoteDiscoveryScheduleService } = await import('../services/noteDiscoveryScheduleService');
    const { noteWriteModule } = await import('../services/NoteUpdateOrchestrator');
    const owners: string[] = [];
    async function fresh() {
      const owner = String(new Types.ObjectId()); owners.push(owner);
      const note = await Note.create({ userId: owner, content: '私有已保存正文', contentText: '私有已保存正文', revision: 1 });
      const run = await Run.create({ userId: owner, status: 'completed', trigger: 'manual', idempotencyKey: 'cleanup-test', generation: 1, watermark: { changedAt: now }, availableAt: now });
      const copy = item.toObject(); delete copy._id; delete copy.exposedAt; delete copy.savedNoteId; delete copy.sessionId;
      const discovery = await Discovery.create({ ...copy, userId: owner, runId: run._id, evidence: [{ noteId: note._id, revision: 1, title: '原文', noteDate: now, excerpt: '已保存', hasImages: false }] });
      return { owner, note, discovery };
    }
    const crashed = await fresh();
    const Chat = (await import('../models/Chat')).default;
    const { NoteDiscoveryChatTurn } = await import('../models/NoteDiscoveryChatTurn');
    const abandonedChat = await Chat.create({ userId: crashed.owner, title: '待清理会话', sourceMode: 'multi_note_discovery', discoveryId: crashed.discovery._id, selectedSourceIds: [crashed.note._id], messages: [{ role: 'user', content: '待清理私有正文' }] });
    const abandonedTurn = await NoteDiscoveryChatTurn.create({ userId: crashed.owner, chatId: abandonedChat._id, requestId: 'marker-crash', status: 'running', generation: 1, leaseToken: 'retain-fence', leaseUntil: new Date(Date.now() + 5000), payload: { messages: [{ content: '待清理私有正文' }] } });
    await NoteDiscoveryAction.create({ userId: crashed.owner, discoveryId: crashed.discovery._id, kind: 'save', targetId: new Types.ObjectId(), payload: { text: '待清理私有草稿' } });
    await NoteDiscoveryCleanup.create({ userId: crashed.owner, requestedAt: now });
    await recoverDiscoveryUserCleanup(crashed.owner);
    assert.equal(await Discovery.countDocuments({ userId: crashed.owner }), 0);
    assert.equal(await Chat.countDocuments({ userId: crashed.owner }), 0);
    assert.equal(await NoteDiscoveryAction.countDocuments({ userId: crashed.owner }), 0);
    const retainedCrashFence: any = await NoteDiscoveryChatTurn.findById(abandonedTurn._id).lean();
    assert.equal(retainedCrashFence.cleanupRequested, true);
    assert.equal(JSON.stringify(retainedCrashFence).includes('私有正文'), false);
    for (const phase of ['exposure', 'action', 'draft'] as const) {
      const f = await fresh();
      let resume!: () => void;
      let reached!: () => void;
      const held = new Promise<void>(resolve => { resume = resolve; });
      const ready = new Promise<void>(resolve => { reached = resolve; });
      let stub;
      if (phase === 'exposure') {
        const original = NoteDiscoveryExposure.updateOne.bind(NoteDiscoveryExposure);
        stub = mock.method(NoteDiscoveryExposure, 'updateOne', (async (...args: any[]) => {
          if (args[1]?.$inc) { reached(); await held; }
          return (original as any)(...args);
        }) as any);
      } else if (phase === 'action') {
        const original = NoteDiscoveryAction.create.bind(NoteDiscoveryAction);
        stub = mock.method(NoteDiscoveryAction, 'create', (async (...args: any[]) => {
          reached(); await held; return (original as any)(...args);
        }) as any);
      } else {
        const original = noteWriteModule.create.bind(noteWriteModule);
        stub = mock.method(noteWriteModule, 'create', async (...args: Parameters<typeof original>) => {
          reached(); await held; return original(...args);
        });
      }
      const scheduleStub = mock.method((noteWriteModule as any).scheduler, 'schedule', () => undefined);
      const pending = phase === 'exposure' ? service.list(f.owner) : service.save(f.owner, f.discovery.id, { text: '清理竞态草稿', idempotencyKey: phase });
      const rejected = assert.rejects(pending, /清理|不可用/);
      await ready;
      await service.cleanupUser(f.owner);
      resume();
      await rejected;
      stub.mock.restore(); scheduleStub.mock.restore();
      await recoverDiscoveryUserCleanup(f.owner);
      assert.equal(await NoteDiscoveryExposure.countDocuments({ userId: f.owner }), 0);
      assert.equal(await NoteDiscoveryAction.countDocuments({ userId: f.owner }), 0);
      assert.equal(await Note.countDocuments({ userId: f.owner }), 1, 'preserve ordinary source, remove only raced draft target');
    }
    const schedule = new NoteDiscoveryScheduleService({ enabled: true });
    await schedule.initializeOnStartup();
    assert.equal(await Preference.countDocuments({ userId: { $in: owners } }), 0);
  });
  it('cleans private data immediately while retaining and recovering only active accounting fences', async () => {
    const { NoteDiscoveryChatTurn } = await import('../models/NoteDiscoveryChatTurn');
    const { NoteDiscoveryBudgetService } = await import('../services/noteDiscoveryBudgetService');
    const { fixturePrice } = await import('./noteDiscoveryRunnerFixture');
    let clock = new Date();
    const deadline = new Date(clock.getTime() + 5000);
    const budget = new NoteDiscoveryBudgetService({ enabled: true, userCapMicros: 1_000_000, globalCapMicros: 5_000_000, attemptCapMicros: 250_000 }, () => clock);
    const turn = await NoteDiscoveryChatTurn.create({ userId, chatId: new Types.ObjectId(), requestId: 'cleanup-inflight', status: 'running', generation: 1, leaseToken: 'cleanup-fence', leaseUntil: deadline, payload: { messages: [{ content: '私有正文' }] } });
    const reservation = await budget.reserveConversation(String(turn._id), userId, { provider: 'deepseek', model: fixturePrice.model, inputCnyPerMillion: 2, outputCnyPerMillion: 8, maxInputTokens: 100, maxOutputTokens: 100 }, { signal: new AbortController().signal, deadline });
    assert.ok(reservation);
    await service.cleanupUser(userId);
    await service.cleanupUser(userId);
    const retained = await NoteDiscoveryChatTurn.findById(turn._id).lean();
    assert.equal(JSON.stringify(retained).includes('私有正文'), false);
    const { Discovery, Preference } = await modules();
    assert.equal(await Discovery.countDocuments({ userId }), 0);
    assert.equal(await Preference.countDocuments({ userId }), 0);
    await assert.rejects(service.run(userId, 'cannot-restart'), /清理|不可用/);
    clock = new Date(deadline.getTime() + 1);
    await budget.recoverConversation(String(turn._id));
    await service.cleanupUser(userId);
    assert.equal(await NoteDiscoveryChatTurn.countDocuments({ userId }), 0);
    const Budget = (await import('../models/NoteDiscoveryBudget')).default;
    const ledger = await Budget.findOne({ 'reservations.id': reservation.id }).lean();
    assert.equal(ledger!.reservations.find(r => r.id === reservation.id)!.state, 'settled');
  });

});
