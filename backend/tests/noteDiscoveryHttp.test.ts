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
  async function freshDiscovery() {
    const { Note, Discovery, Run } = await modules();
    const owner = String(new Types.ObjectId());
    const note = await Note.create({ userId: owner, content: '私有已保存正文', contentText: '私有已保存正文', revision: 1 });
    const run = await Run.create({ userId: owner, status: 'completed', trigger: 'manual', idempotencyKey: 'race-test', generation: 1, watermark: { changedAt: now }, availableAt: now });
    const copy = item.toObject(); delete copy._id; delete copy.exposedAt; delete copy.savedNoteId; delete copy.sessionId;
    const discovery = await Discovery.create({ ...copy, userId: owner, runId: run._id, evidence: [{ noteId: note._id, revision: 1, title: '原文', noteDate: now, excerpt: '已保存', hasImages: false }] });
    return { owner, note, discovery };
  }
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
  it('hides and rejects discovery for a signed-in account outside the local allowlist', async () => {
    const { config } = await import('../config');
    const previous = config.NOTE_DISCOVERY_LOCAL_USER_ID;
    config.NOTE_DISCOVERY_LOCAL_USER_ID = new Types.ObjectId().toHexString();
    try {
      const availability = await request('/availability');
      assert.equal(availability.status, 200);
      assert.deepEqual(availability.json.data, { available: false });
      const read = await request('?admit=true');
      assert.equal(read.status, 200);
      assert.equal(read.json.data.available, false);
      assert.deepEqual(read.json.data.items, []);
      const run = await request('/run', 'POST', { idempotencyKey: 'blocked-local' });
      assert.equal(run.status, 503);
      assert.equal(run.json.code, 'DISCOVERY_DISABLED');
    } finally { config.NOTE_DISCOVERY_LOCAL_USER_ID = previous; }
  });
  it('returns the current manual denial and retry time through the authenticated route', async () => {
    const retryAt = new Date('2026-11-22T00:00:00Z');
    const stub = mock.method(service.schedule, 'requestManual', async () => ({status:'limited',currentRun:null,retryAt}));
    try {
      const result = await request('/run','POST',{idempotencyKey:'current-manual-denial'});
      assert.equal(result.status,429);
      assert.equal(result.json.code,'DISCOVERY_RATE_LIMITED');
      assert.equal(result.json.retryAt,retryAt.toISOString());
    } finally { stub.mock.restore(); }
  });
  it('requires authentication and rejects foreign/unpublished discovery actions without data leakage', async () => {
    assert.equal((await request('', 'GET', undefined, '')).status, 401);
    assert.equal((await request('/availability', 'GET', undefined, '')).status, 401);
    assert.equal((await request(`/${new Types.ObjectId()}/feedback`, 'POST', { kind: 'not_related' })).status, 404);
    const { Discovery } = await modules();
    await Discovery.updateOne({ _id: item._id }, { $set: { generation: 2 } });
    assert.equal((await request(`/${item.id}/save`, 'POST', { text: '确认', idempotencyKey: 'x' })).status, 409);
    await Discovery.updateOne({ _id: item._id }, { $set: { generation: 1 } });
  });
  it('atomically caps concurrent first exposure at three local-day slots, keeps candidates and permits explicit history', async () => {
    const { config } = await import('../config');
    const previous = config.NOTE_DISCOVERY_LOCAL_USER_ID;
    const wasRunnable = config.NOTE_DISCOVERY_RUNNABLE;
    config.NOTE_DISCOVERY_LOCAL_USER_ID = userId;
    try {
      config.NOTE_DISCOVERY_RUNNABLE = false;
      assert.deepEqual((await request('/availability')).json.data, { available: false });
      config.NOTE_DISCOVERY_RUNNABLE = true;
      const available = await request('/availability');
      assert.equal(available.status, 200);
      assert.deepEqual(available.json.data, { available: true });
      const { Discovery } = await modules();
      assert.equal(await Discovery.countDocuments({ userId, exposedAt: { $exists: true } }), 0);
    } finally {
      config.NOTE_DISCOVERY_LOCAL_USER_ID = previous;
      config.NOTE_DISCOVERY_RUNNABLE = wasRunnable;
    }
    const results = await Promise.all(Array.from({ length: 5 }, () => request('')));
    assert.ok(results.every(r => r.status === 200));
    const { Discovery } = await modules();
    assert.equal(await Discovery.countDocuments({ userId, exposedAt: { $exists: true } }), 3);
    assert.equal(await Discovery.countDocuments({ userId }), 6);
    assert.equal((await request('?history=true&admit=false')).json.data.items.length, 6);
    assert.equal(await Discovery.countDocuments({ userId, exposedAt: { $exists: true } }), 3, 'history does not consume daily home exposure');
    assert.equal((await request('?history=true', 'GET', undefined, '')).status, 401);
    now = new Date('2026-11-20T16:01:00Z');
    await request('');
    assert.equal(await Discovery.countDocuments({ userId, exposedAt: { $exists: true } }), 6);
  });
  it('history retains owner and current source/publication guards', async () => {
    const { Discovery, Note } = await modules();
    const f = await freshDiscovery();
    assert.ok((await service.list(f.owner,{history:true,admit:false})).items.some((d:any)=>d.id===f.discovery.id));
    assert.ok(!(await service.list(userId,{history:true,admit:false})).items.some((d:any)=>d.id===f.discovery.id));
    await Discovery.updateOne({_id:f.discovery._id},{$set:{generation:2}});
    assert.equal((await service.list(f.owner,{history:true,admit:false})).items.length,0);
    await Discovery.updateOne({_id:f.discovery._id},{$set:{generation:1}});
    await Note.updateOne({_id:f.note._id},{$set:{revision:2,content:'来源已变更',contentText:'来源已变更'}});
    assert.equal((await service.list(f.owner,{history:true,admit:false})).items.length,0);
    await Note.deleteOne({_id:f.note._id});
    assert.equal((await service.list(f.owner,{history:true,admit:false})).items.length,0);
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

  it('keeps polling outside scheduler admission and exposes a terminal failed run', async () => {
    const {Run}=await modules();
    const {NoteDiscoveryApiService}=await import('../services/noteDiscoveryApiService');
    let visits=0;
    const schedule={initializeOnVisit:async()=>{visits++;return {status:'idle',currentRun:null};}} as any;
    const readService=new NoteDiscoveryApiService({enabled:()=>true,now:()=>now,schedule});
    const owner=String(new Types.ObjectId());
    await Run.create({userId:owner,trigger:'automatic',idempotencyKey:'known-failure',status:'failed',failureCategory:'provider_failed',generation:1,watermark:{changedAt:now},availableAt:now});
    await readService.list(owner,{admit:true});
    for(let i=0;i<3;i++) assert.equal((await readService.list(owner,{admit:false})).run.status,'failed');
    assert.equal(visits,1);
    assert.equal(await Run.countDocuments({userId:owner}),1);
  });
  it('retries a confirmed unsent initial failure on explicit intent and reuses one stable session', async () => {
    const f=await freshDiscovery();
    const {noteDiscoveryConversationService,NoteDiscoveryConversationService}=await import('../services/noteDiscoveryConversationService');
    const {createDiscoveryProvider}=await import('../services/noteDiscoveryProvider');
    const {fixturePrice,scriptTransport,providerResponse}=await import('./noteDiscoveryRunnerFixture');
    const {NoteDiscoveryBudgetService}=await import('../services/noteDiscoveryBudgetService');
    const scripted=scriptTransport(providerResponse({reply:'已推进明确选择的行动'}),providerResponse({reply:'继续比较的回答'}));
    const budget=new NoteDiscoveryBudgetService({enabled:true,userCapMicros:1_000_000,globalCapMicros:5_000_000,attemptCapMicros:250_000});
    const conversation=new NoteDiscoveryConversationService({enabled:()=>true,provider:createDiscoveryProvider(fixturePrice,scripted.transport),budget});
    const execute=mock.method(noteDiscoveryConversationService,'execute',conversation.execute.bind(conversation));
    const denied=mock.method(budget,'reserveConversation',async()=>null);
    const User=(await import('../models/User')).default;
    await User.collection.insertOne({_id:new Types.ObjectId(f.owner),email:'retry@example.invalid',isActive:true});
    const auth=(await import('../utils/jwt')).generateToken({userId:f.owner,username:'retry',email:'retry@example.invalid'});
    const rejected=await request(`/${f.discovery.id}/session`,'POST',{},auth);
    assert.equal(rejected.status,429);assert.equal(rejected.json.retryEligible,true);assert.equal(rejected.json.requestId,'discovery-initial');
    denied.mock.restore();
    await assert.rejects(service.session(f.owner,f.discovery.id), (e:any)=>e.details?.retryEligible===true);
    assert.equal(scripted.calls.length,0);
    const retried=await request(`/${f.discovery.id}/session`,'POST',{retryOfRequestId:'discovery-initial'},auth);
    assert.equal(retried.status,200);
    const result=retried.json.data;
    const replay=await service.session(f.owner,f.discovery.id,{retryOfRequestId:'discovery-initial'});
    assert.equal(String(result.session._id),String(replay.session._id));
    assert.equal(scripted.calls.length,1);
    const Chat=(await import('../models/Chat')).default;
    assert.equal(await Chat.countDocuments({userId:f.owner}),1);
    const deniedNext=mock.method(budget,'reserveConversation',async()=>null);
    const stream=async(body:unknown)=>{const response=await fetch(base+'/api/chat',{method:'POST',headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:JSON.stringify(body)});return response.text();};
    const next={sessionId:String(result.session._id),requestId:'http-next',messages:[{role:'user',content:'继续比较'}]};
    const failure=await stream(next);
    assert.ok(failure.includes('\"retryEligible\":true'));assert.ok(failure.includes('\"requestId\":\"http-next\"'));
    deniedNext.mock.restore();
    const success=await stream({...next,retryOfRequestId:'http-next'});
    assert.ok(success.includes('\"type\":\"committed\"'));assert.equal(scripted.calls.length,2);
    const repeated=await stream({...next,retryOfRequestId:'http-next'});
    assert.ok(repeated.includes('\"type\":\"committed\"'));assert.equal(scripted.calls.length,2);
    const changed=await stream({...next,retryOfRequestId:'http-next',messages:[{role:'user',content:'另一份修改后的问题'}]});
    assert.ok(changed.includes('CHAT_RETRY_PAYLOAD_MISMATCH'));assert.ok(!changed.includes('\"type\":\"committed\"'));assert.equal(scripted.calls.length,2);
    const {Note}=await modules();await Note.updateOne({_id:f.note._id},{$set:{content:'来源已修改',contentText:'来源已修改',revision:2}});
    assert.equal((await service.session(f.owner,f.discovery.id)).reused,true);assert.equal(scripted.calls.length,2);
    execute.mock.restore();
  });

  it('revalidates a stale discovery before a fresh empty-session retry without blocking old attempt reconciliation',async()=>{
    const f=await freshDiscovery();
    const {noteDiscoveryConversationService,NoteDiscoveryConversationService}=await import('../services/noteDiscoveryConversationService');
    const {createDiscoveryProvider}=await import('../services/noteDiscoveryProvider');
    const {fixturePrice,scriptTransport,providerResponse}=await import('./noteDiscoveryRunnerFixture');
    const {NoteDiscoveryBudgetService}=await import('../services/noteDiscoveryBudgetService');
    const scripted=scriptTransport(providerResponse({reply:'不应发送'}));
    const budget=new NoteDiscoveryBudgetService({enabled:true,userCapMicros:1_000_000,globalCapMicros:5_000_000,attemptCapMicros:250_000});
    const conversation=new NoteDiscoveryConversationService({enabled:()=>true,provider:createDiscoveryProvider(fixturePrice,scripted.transport),budget});
    const execute=mock.method(noteDiscoveryConversationService,'execute',conversation.execute.bind(conversation));
    const denied=mock.method(budget,'reserveConversation',async()=>null);
    await assert.rejects(service.session(f.owner,f.discovery.id),(e:any)=>e.details?.retryEligible===true);
    denied.mock.restore();
    const {Note}=await modules();await Note.updateOne({_id:f.note._id},{$set:{content:'新版正文',contentText:'新版正文',revision:2}});
    await assert.rejects(service.session(f.owner,f.discovery.id,{retryOfRequestId:'discovery-initial'}),(e:any)=>e.details?.code==='DISCOVERY_STALE');
    await assert.rejects(service.session(f.owner,f.discovery.id),(e:any)=>e.details?.retryEligible===true);
    assert.equal(scripted.calls.length,0);
    execute.mock.restore();
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
  it('keeps an eligible homepage card behind more than100 feedback-hidden discoveries', async () => {
    const f = await freshDiscovery();
    const { Discovery, Preference } = await modules();
    const hidden = await Discovery.insertMany(Array.from({ length: 105 }, (_, i) => {
      const copy: any = f.discovery.toObject(); delete copy._id;
      return { ...copy, createdAt: new Date(now.getTime() + i + 1), observationFingerprint: `hidden-${i}` };
    }));
    await Preference.create({ userId: f.owner, automaticEnabled: false, feedback: hidden.map(d => ({
      kind: 'not_interested', discoveryId: d._id, sourceIds: [f.note._id], sourceFingerprint: 'source', observationFingerprint: d.observationFingerprint, createdAt: now,
    })) });
    const result = await service.list(f.owner);
    assert.deepEqual(result.items.map((d: any) => d.id), [f.discovery.id]);
  });
  it('fences pending-save retries across normal deletion including lost creation acknowledgements', async () => {
    const { Note } = await modules();
    const { noteWriteModule } = await import('../services/NoteUpdateOrchestrator');
    const { noteService } = await import('../services/noteService');
    const { NoteDiscoveryAction } = await import('../models/NoteDiscoveryAction');
    const scheduler = mock.method((noteWriteModule as any).scheduler, 'schedule', () => undefined);
    for (const phase of ['before-create', 'lost-ack'] as const) {
      const f = await freshDiscovery();
      let resume!: () => void;
      let reached!: () => void;
      const held = new Promise<void>(resolve => { resume = resolve; });
      const ready = new Promise<void>(resolve => { reached = resolve; });
      const original = noteWriteModule.create.bind(noteWriteModule);
      let first = true;
      const stub = mock.method(noteWriteModule, 'create', async (...args: Parameters<typeof original>) => {
        if (!first) return original(...args);
        first = false;
        if (phase === 'lost-ack') { await original(...args); reached(); await held; throw new Error('synthetic process exit after insert'); }
        reached(); await held; return original(...args);
      });
      const pending = service.save(f.owner, f.discovery.id, { text: '确认正文', idempotencyKey: phase });
      const rejected = assert.rejects(pending, phase === 'lost-ack' ? /process exit/ : /已删除|不可访问/);
      await ready;
      const action = await NoteDiscoveryAction.findOne({ userId: f.owner, discoveryId: f.discovery._id, kind: 'save' });
      if (phase === 'before-create') await service.save(f.owner, f.discovery.id, { text: '确认正文', idempotencyKey: 'winner' });
      await noteService.deleteNote(f.owner, String(action.targetId));
      const raw = await Note.collection.findOne({ _id: action.targetId });
      assert.deepEqual(Object.keys(raw!).sort(), ['_id', 'discoveryDeletedAt']);
      resume(); await rejected; stub.mock.restore();
      await assert.rejects(service.save(f.owner, f.discovery.id, { text: '不得复活', idempotencyKey: 'again' }), /已删除|不可访问/);
      assert.equal(await Note.countDocuments({ _id: action.targetId }), 0);
      assert.equal(await Note.findOne({ _id: action.targetId }), null);
      assert.deepEqual(await Note.distinct('_id', { _id: action.targetId }), []);
      assert.deepEqual(await Note.aggregate([{ $match: { _id: action.targetId } }]), []);
      assert.equal((await Note.updateOne({ _id: action.targetId }, { $set: { content: '不能修改墓碑' } })).matchedCount, 0);
      await assert.rejects(noteService.getNote(f.owner, String(action.targetId)), /不存在|无权限/);
      await assert.rejects(noteService.deleteNote(f.owner, String(action.targetId)), /不存在|无权限/);
      assert.deepEqual(Object.keys((await Note.collection.findOne({ _id: action.targetId }))!).sort(), ['_id', 'discoveryDeletedAt']);
      await noteService.deleteNote(f.owner, f.note.id);
      assert.equal(await Note.collection.findOne({ _id: f.note._id }), null, 'ordinary source notes still physically delete');
    }
    scheduler.mock.restore();
  });
  it('captures pending targets before session-triggered erasure and blocks a late insert after process exit', async () => {
    const f = await freshDiscovery();
    const { Note } = await modules();
    const { NoteDiscoveryCleanup } = await import('../models/NoteDiscoveryCleanup');
    const { NoteDiscoveryAction } = await import('../models/NoteDiscoveryAction');
    const { noteWriteModule } = await import('../services/NoteUpdateOrchestrator');
    const { recoverDiscoveryUserCleanup } = await import('../services/noteDiscoveryApiService');
    const Chat = (await import('../models/Chat')).default;
    let resumeSave!: () => void;
    let saveReached!: () => void;
    const saveReady = new Promise<void>(resolve => { saveReached = resolve; });
    const saveHeld = new Promise<void>(resolve => { resumeSave = resolve; });
    const originalCreate = noteWriteModule.create.bind(noteWriteModule);
    const saveStub = mock.method(noteWriteModule, 'create', async (...args: Parameters<typeof originalCreate>) => {
      saveReached(); await saveHeld; await originalCreate(...args); throw new Error('synthetic process exit');
    });
    const pendingSave = service.save(f.owner, f.discovery.id, { text: '待擦除草稿', idempotencyKey: 'session-race' });
    const rejectedSave = assert.rejects(pendingSave, /清理|不可用|已删除/);
    await saveReady;
    const saveAction = await NoteDiscoveryAction.findOne({ userId: f.owner, discoveryId: f.discovery._id, kind: 'save' });
    let resumeSession!: () => void;
    let sessionReached!: () => void;
    const sessionReady = new Promise<void>(resolve => { sessionReached = resolve; });
    const sessionHeld = new Promise<void>(resolve => { resumeSession = resolve; });
    const originalChat = Chat.findOneAndUpdate.bind(Chat);
    const sessionStub = mock.method(Chat, 'findOneAndUpdate', (async (...args: any[]) => {
      const result = await (originalChat as any)(...args); sessionReached(); await sessionHeld; return result;
    }) as any);
    const pendingSession = service.session(f.owner, f.discovery.id);
    const rejectedSession = assert.rejects(pendingSession, /清理|不可用/);
    await sessionReady;
    // Simulate a cleanup process that persisted its marker and then exited before its erasure pass.
    await NoteDiscoveryCleanup.create({ userId: f.owner, requestedAt: now });
    resumeSession(); await rejectedSession; sessionStub.mock.restore();
    const marker: any = await NoteDiscoveryCleanup.findOne({ userId: f.owner }).lean();
    assert.ok(marker.cancelledSaveTargets.some((id: any) => String(id) === String(saveAction.targetId)));
    assert.equal(await NoteDiscoveryAction.countDocuments({ userId: f.owner }), 0);
    resumeSave(); await rejectedSave; saveStub.mock.restore();
    await recoverDiscoveryUserCleanup(f.owner);
    assert.equal(await Note.countDocuments({ _id: saveAction.targetId }), 0);
    assert.deepEqual(Object.keys((await Note.collection.findOne({ _id: saveAction.targetId }))!).sort(), ['_id', 'discoveryDeletedAt']);
  });
  it('leaves actions inserted after the erasure snapshot for durable target capture on the next replay', async () => {
    const f = await freshDiscovery();
    const { Note } = await modules();
    const { NoteDiscoveryAction } = await import('../models/NoteDiscoveryAction');
    const { NoteDiscoveryCleanup } = await import('../models/NoteDiscoveryCleanup');
    const { recoverDiscoveryUserCleanup } = await import('../services/noteDiscoveryApiService');
    const { noteWriteModule } = await import('../services/NoteUpdateOrchestrator');
    await NoteDiscoveryCleanup.create({ userId: f.owner, requestedAt: now });
    const original = NoteDiscoveryAction.deleteMany.bind(NoteDiscoveryAction);
    let resume!: () => void;
    let reached!: () => void;
    const held = new Promise<void>(resolve => { resume = resolve; });
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const stub = mock.method(NoteDiscoveryAction, 'deleteMany', (async (...args: any[]) => {
      reached(); await held; return (original as any)(...args);
    }) as any);
    const erasure = recoverDiscoveryUserCleanup(f.owner);
    await ready;
    const targetId = new Types.ObjectId();
    const action = await NoteDiscoveryAction.create({ userId: f.owner, discoveryId: f.discovery._id, kind: 'save', targetId, payload: { text: '迟到的私有草稿' } });
    resume(); await erasure; stub.mock.restore();
    assert.ok(await NoteDiscoveryAction.findById(action._id), 'uncaptured target must not lose its sole durable record');
    const schedule = mock.method((noteWriteModule as any).scheduler, 'schedule', () => undefined);
    await noteWriteModule.create({ userId: f.owner, stableNoteId: String(targetId), body: { kind: 'plain-text', text: '迟到的私有草稿' } });
    // Simulate process exit before the save post-write check; only the marker replay remains.
    await recoverDiscoveryUserCleanup(f.owner);
    assert.equal(await NoteDiscoveryAction.findById(action._id), null);
    assert.equal(await Note.findById(targetId), null);
    assert.deepEqual(Object.keys((await Note.collection.findOne({ _id: targetId }))!).sort(), ['_id', 'discoveryDeletedAt']);
    schedule.mock.restore();
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
