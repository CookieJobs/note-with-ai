import assert from 'node:assert/strict';
import { describe, it, after, mock, afterEach } from 'node:test';
import { Types } from 'mongoose';
import { connectNoteDiscoveryTestMongo, noteDiscoveryMongoTestOptions } from './noteDiscoveryTestMongo';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-secret';
process.env.DEEPSEEK_API_KEY ||= 'synthetic-key';
process.env.OPENROUTER_API_KEY ||= 'synthetic-key';

describe('discovery multi-note chat', noteDiscoveryMongoTestOptions, () => {
  let cleanup: () => Promise<void>;
  after(async () => { await cleanup?.(); });
  afterEach(() => mock.restoreAll());
  it('reloads current bound saved sources, retains historical snapshots and blocks foreign replacements', async () => {
    cleanup = await connectNoteDiscoveryTestMongo('worker');
    const { Note } = await import('../models/Note');
    const Chat = (await import('../models/Chat')).default;
    const { chatService } = await import('../services/chatService');
    const userId = new Types.ObjectId().toString();
    const note = await Note.create({ userId, content: '今天已更新为十分钟', contentText: '今天已更新为十分钟', revision: 2 });
    const old = { noteId: note.id, contentText: '旧文', revision: 1, updatedAt: new Date().toISOString(), hasImages: false };
    const chat = await Chat.create({ userId, title: '发现', sourceMode: 'multi_note_discovery', discoveryId: new Types.ObjectId(), selectedSourceIds: [note._id], messages: [{ role: 'assistant', content: '旧答', sourceSnapshots: [old] }] });
    const prepared = await chatService.prepareTurn(userId, [{ role: 'user', content: '继续' }], chat.id);
    assert.equal(prepared.sourceSnapshots?.[0].revision, 2);
    assert.equal(prepared.messages[0].sourceSnapshots?.[0].revision, 1);
    await assert.rejects(chatService.prepareTurn(userId, [{ role: 'user', content: '继续' }], chat.id, new Types.ObjectId().toString()), /绑定|笔记/);
    await Note.updateOne({ _id: note._id }, { $set: { userId: new Types.ObjectId() } });
    await assert.rejects(chatService.prepareTurn(userId, [{ role: 'user', content: '继续' }], chat.id), /笔记.*不存在|无法访问/);
  });
});

describe('metered durable discovery conversation turns', noteDiscoveryMongoTestOptions, () => {
  let cleanup: () => Promise<void>;
  after(async () => { await cleanup?.(); });
  afterEach(() => mock.restoreAll());
  async function fixture() {
    const { Note } = await import('../models/Note');
    const Chat = (await import('../models/Chat')).default;
    const userId = new Types.ObjectId().toString();
    const notes = await Promise.all(['周一练习十分钟', '周三练习十五分钟'].map(content => Note.create({ userId, content, contentText: content, revision: 1 })));
    const chat = await Chat.create({ userId, title: '多篇继续', sourceMode: 'multi_note_discovery', discoveryId: new Types.ObjectId(), selectedSourceIds: notes.map(n => n._id), messages: [] });
    const { NoteDiscoveryBudgetService } = await import('../services/noteDiscoveryBudgetService');
    const budget = new NoteDiscoveryBudgetService({ enabled: true, userCapMicros: 1_000_000, globalCapMicros: 5_000_000, attemptCapMicros: 250_000 });
    const { fixturePrice, scriptTransport, providerResponse } = await import('./noteDiscoveryRunnerFixture');
    const scripted = scriptTransport(...Array.from({ length: 5 }, () => providerResponse({ reply: '先按两次记录比较时长，再问是否需要调整。' })));
    const { createDiscoveryProvider } = await import('../services/noteDiscoveryProvider');
    const { NoteDiscoveryConversationService } = await import('../services/noteDiscoveryConversationService');
    const provider = createDiscoveryProvider(fixturePrice, scripted.transport)!;
    const service = new NoteDiscoveryConversationService({ enabled: () => true, provider, budget });
    const { chatService } = await import('../services/chatService');
    const prepared = await chatService.prepareTurn(userId, [{ role: 'user', content: '比较一下' }], chat.id);
    return { userId, chat, notes, budget, scripted, service, prepared, provider };
  }
  it('dispatches one metered attempt, commits sourceSnapshot[] and replays without another payment or scheduler quota', async () => {
    cleanup = await connectNoteDiscoveryTestMongo('worker');
    const f = await fixture();
    const { noteDiscoveryConversationService } = await import('../services/noteDiscoveryConversationService');
    const { chatTurnCommitService } = await import('../services/chatTurnCommitService');
    const { chatService } = await import('../services/chatService');
    const { NoteDiscoveryChatTurn } = await import('../models/NoteDiscoveryChatTurn');
    const Run = (await import('../models/NoteDiscoveryRun')).default;
    await NoteDiscoveryChatTurn.init();
    mock.method(noteDiscoveryConversationService, 'execute', f.service.execute.bind(f.service));
    mock.method(chatService, 'summarizeTitle', () => { assert.fail('multi-note turns cannot call hidden title model'); });
    mock.method(chatService, 'streamChat', () => { assert.fail('multi-note turns cannot use legacy retry helper'); });
    const input = { userId: f.userId, sessionId: f.chat.id, requestId: 'turn-one', messages: [{ role: 'user' as const, content: '比较一下' }], onChunk: () => true };
    const first = await chatTurnCommitService.streamAndCommit(input);
    const replay = await chatTurnCommitService.streamAndCommit(input);
    assert.equal(f.scripted.calls.length, 1);
    assert.equal(first.fullReply, replay.fullReply);
    assert.equal((first.session.messages as any[])[1].sourceSnapshots.length, 2);
    assert.equal(await Run.countDocuments({ userId: f.userId }), 0);
    const Budget = (await import('../models/NoteDiscoveryBudget')).default;
    const ledger = await Budget.findOne({ 'reservations.userId': f.userId }).lean();
    const reservation = ledger!.reservations.find(r => String(r.userId) === f.userId)!;
    assert.equal(reservation.operationKind, 'conversation');
    assert.equal(reservation.state, 'settled');
    assert.equal(reservation.outcome, 'known');
    for (let index = 2; index <= 4; index++) await chatTurnCommitService.streamAndCommit({ ...input, requestId: `turn-${index}` });
    assert.equal(f.scripted.calls.length, 4, 'four conversation turns must not consume the three manual discovery allowance');
  });
  it('rejects stale authoritative history before paying and replays a committed turn after source deletion', async () => {
    const f = await fixture();
    const { chatService } = await import('../services/chatService');
    const { chatTurnCommitService } = await import('../services/chatTurnCommitService');
    const { noteDiscoveryConversationService } = await import('../services/noteDiscoveryConversationService');
    const { Note } = await import('../models/Note');
    mock.method(noteDiscoveryConversationService, 'execute', f.service.execute.bind(f.service));
    const original = chatService.prepareTurn.bind(chatService);
    let resume!: () => void;
    let captured!: () => void;
    const ready = new Promise<void>(resolve => { captured = resolve; });
    const held = new Promise<void>(resolve => { resume = resolve; });
    let first = true;
    mock.method(chatService, 'prepareTurn', async (...args: Parameters<typeof original>) => {
      const prepared = await original(...args);
      if (first) { first = false; captured(); await held; }
      return prepared;
    });
    const input = { userId: f.userId, sessionId: f.chat.id, messages: [{ role: 'user' as const, content: '继续' }], onChunk: () => true };
    const stale = chatTurnCommitService.streamAndCommit({ ...input, requestId: 'stale' });
    await ready;
    const committed = await chatTurnCommitService.streamAndCommit({ ...input, requestId: 'winner' });
    resume();
    await assert.rejects(stale, /对话已变化/);
    assert.equal(f.scripted.calls.length, 1);
    await Note.deleteMany({ _id: { $in: f.notes.map(n => n._id) } });
    const replay = await chatTurnCommitService.streamAndCommit({ ...input, requestId: 'winner' });
    assert.deepEqual(replay.session.messages, committed.session.messages);
    await assert.rejects(chatTurnCommitService.streamAndCommit({ ...input, requestId: 'new-after-deletion' }), /不存在|无法访问/);
    assert.equal(f.scripted.calls.length, 1);
  });
  it('bounds held eligibility and settlement acknowledgements while retaining sweep recovery', async () => {
    for (const phase of ['isDispatchableReservation', 'settle'] as const) {
      const f = await fixture();
      const { NoteDiscoveryConversationService } = await import('../services/noteDiscoveryConversationService');
      const { NoteDiscoveryChatTurn } = await import('../models/NoteDiscoveryChatTurn');
      let resume!: () => void;
      const held = new Promise<void>(resolve => { resume = resolve; });
      const original = f.budget[phase].bind(f.budget) as any;
      const stub = mock.method(f.budget, phase, (async (...args: any[]) => {
        const result = await original(...args); await held; return result;
      }) as any);
      const service = new NoteDiscoveryConversationService({ enabled: () => true, provider: f.provider, budget: f.budget, timeoutMs: 150 });
      const start = Date.now();
      await assert.rejects(service.execute({ userId: f.userId, chatId: f.chat.id, requestId: phase,
        messages: f.prepared.messages, sourceSnapshots: f.prepared.sourceSnapshots! }), /超时/);
      assert.ok(Date.now() - start < 1000);
      assert.equal(f.scripted.calls.length, phase === 'settle' ? 1 : 0);
      resume(); stub.mock.restore();
      const turn = await NoteDiscoveryChatTurn.findOne({ userId: f.userId, requestId: phase });
      await f.budget.recoverConversation(String(turn._id));
      assert.equal((await NoteDiscoveryChatTurn.findById(turn._id)).status, 'failed');
      await assert.rejects(service.execute({ userId: f.userId, chatId: f.chat.id, requestId: phase, messages: [], sourceSnapshots: [] }), /未完成|过期/);
    }
  });
  it('retains trusted snapshots through public /save and rejects arbitrary replacement history', async () => {
    const f = await fixture();
    const { chatService } = await import('../services/chatService');
    const result = await f.service.execute({ userId: f.userId, chatId: f.chat.id, requestId: 'safe', messages: f.prepared.messages, sourceSnapshots: f.prepared.sourceSnapshots! });
    const ordinary = result.session.messages.map((m: any) => ({ role: m.role, content: m.content, sourceSnapshots: [{ noteId: 'forged' }] }));
    const saved = await chatService.saveSession(f.userId, f.chat.id, ordinary as any);
    assert.equal(saved.messages[1].sourceSnapshots?.length, 2);
    assert.equal(saved.messages[1].sourceSnapshots?.[0].noteId, f.notes[0].id);
    await assert.rejects(chatService.saveSession(f.userId, f.chat.id, [{ role: 'assistant', content: '伪造回答' }]), /聊天|修改/);
  });
  it('charges unknown delivery conservatively and never resends the same request', async () => {
    const f = await fixture();
    const { createDiscoveryProvider } = await import('../services/noteDiscoveryProvider');
    const { NoteDiscoveryConversationService } = await import('../services/noteDiscoveryConversationService');
    const { fixturePrice } = await import('./noteDiscoveryRunnerFixture');
    let calls = 0;
    const provider = createDiscoveryProvider(fixturePrice, async () => { calls++; throw new Error('network ambiguity'); })!;
    const service = new NoteDiscoveryConversationService({ enabled: () => true, provider, budget: f.budget });
    const input = { userId: f.userId, chatId: f.chat.id, requestId: 'unknown', messages: f.prepared.messages, sourceSnapshots: f.prepared.sourceSnapshots! };
    await assert.rejects(service.execute(input), /未完成|暂时/);
    await assert.rejects(service.execute(input), /未完成/);
    assert.equal(calls, 1);
    const Budget = (await import('../models/NoteDiscoveryBudget')).default;
    const ledger = await Budget.findOne({ 'reservations.userId': f.userId }).lean();
    const reservation = ledger!.reservations.find(r => String(r.userId) === f.userId)!;
    assert.equal(reservation.settledMicros, reservation.reservedMicros);
    assert.equal(reservation.delivery, 'delivery_unknown');
  });
  it('repairs an expired create/commit acknowledgement gap from the stored reply without another model call', async () => {
    const f = await fixture();
    const { NoteDiscoveryChatTurn } = await import('../models/NoteDiscoveryChatTurn');
    const operation = await NoteDiscoveryChatTurn.create({ userId: f.userId, chatId: f.chat.id, requestId: 'crash', status: 'running', leaseToken: 'expired', generation: 1,
      leaseUntil: new Date(Date.now() - 1000), reply: '已经完成的回答', payload: { messages: f.prepared.messages, sourceSnapshots: f.prepared.sourceSnapshots, baseVersion: 0 } });
    await f.budget.recoverConversation(String(operation._id));
    const recovered = await f.service.execute({ userId: f.userId, chatId: f.chat.id, requestId: 'crash', messages: [], sourceSnapshots: [] });
    assert.equal(recovered.fullReply, '已经完成的回答');
    assert.equal(recovered.session.messages[1].sourceSnapshots![0].noteId, f.notes[0].id);
    assert.equal(f.scripted.calls.length, 0);
  });
  it('replays a committed answer after the chat write acknowledgement is lost without another paid dispatch', async () => {
    const f = await fixture();
    const Chat = (await import('../models/Chat')).default;
    const { NoteDiscoveryChatTurn } = await import('../models/NoteDiscoveryChatTurn');
    const original = Chat.findOneAndUpdate.bind(Chat);
    mock.method(Chat, 'findOneAndUpdate', (async (...args: any[]) => {
      await (original as any)(...args);
      throw new Error('synthetic lost chat write acknowledgement');
    }) as any);
    const input = { userId: f.userId, chatId: f.chat.id, requestId: 'commit-ack-gap',
      messages: f.prepared.messages, sourceSnapshots: f.prepared.sourceSnapshots! };
    await assert.rejects(f.service.execute(input), /lost chat write acknowledgement/);
    const pending = await NoteDiscoveryChatTurn.findOne({ userId: f.userId, requestId: input.requestId });
    assert.equal(pending.status, 'running', 'reply intent must remain recoverable after an uncertain commit');
    assert.ok(pending.reply);
    const replay = await f.service.execute(input);
    assert.equal(replay.fullReply, pending.reply);
    assert.equal(replay.session.messages.length, 2);
    assert.equal(replay.session.messages[1].sourceSnapshots!.length, 2);
    assert.equal(f.scripted.calls.length, 1);
    assert.equal((await NoteDiscoveryChatTurn.findById(pending._id)).status, 'completed');
  });
  it('returns at the deadline during a held chat-write acknowledgement and independently replays its committed answer', async () => {
    const f = await fixture();
    const Chat = (await import('../models/Chat')).default;
    const { NoteDiscoveryConversationService } = await import('../services/noteDiscoveryConversationService');
    const { NoteDiscoveryChatTurn } = await import('../models/NoteDiscoveryChatTurn');
    const original = Chat.findOneAndUpdate.bind(Chat);
    let resume!: () => void;
    const held = new Promise<void>(resolve => { resume = resolve; });
    const stub = mock.method(Chat, 'findOneAndUpdate', (async (...args: any[]) => {
      const result = await (original as any)(...args); await held; return result;
    }) as any);
    const service = new NoteDiscoveryConversationService({ enabled: () => true, provider: f.provider, budget: f.budget, timeoutMs: 150 });
    const input = { userId: f.userId, chatId: f.chat.id, requestId: 'held-commit', messages: f.prepared.messages, sourceSnapshots: f.prepared.sourceSnapshots! };
    const start = Date.now();
    await assert.rejects(service.execute(input), /超时/);
    assert.ok(Date.now() - start < 1000);
    const turn = await NoteDiscoveryChatTurn.findOne({ userId: f.userId, requestId: input.requestId });
    await f.budget.recoverConversation(String(turn._id));
    const replay = await service.execute(input);
    assert.equal(replay.fullReply, turn.reply);
    assert.equal(replay.session.messages.length, 2);
    assert.equal(f.scripted.calls.length, 1);
    resume(); stub.mock.restore();
  });
  it('bounds operation creation and initial cleanup lookup acknowledgements without paying after uncertain inserts', async () => {
    for (const phase of ['create', 'cleanup'] as const) {
      const f = await fixture();
      const { NoteDiscoveryChatTurn } = await import('../models/NoteDiscoveryChatTurn');
      const { NoteDiscoveryCleanup } = await import('../models/NoteDiscoveryCleanup');
      const { NoteDiscoveryConversationService } = await import('../services/noteDiscoveryConversationService');
      let resume!: () => void;
      const held = new Promise<void>(resolve => { resume = resolve; });
      let stub;
      if (phase === 'create') {
        const original = NoteDiscoveryChatTurn.create.bind(NoteDiscoveryChatTurn);
        stub = mock.method(NoteDiscoveryChatTurn, 'create', (async (...args: any[]) => {
          const row = await (original as any)(...args); await held; return row;
        }) as any);
      } else {
        const original = NoteDiscoveryCleanup.exists.bind(NoteDiscoveryCleanup);
        let calls = 0;
        stub = mock.method(NoteDiscoveryCleanup, 'exists', (async (...args: any[]) => {
          const result = await (original as any)(...args);
          if (++calls === 2) await held;
          return result;
        }) as any);
      }
      const service = new NoteDiscoveryConversationService({ enabled: () => true, provider: f.provider, budget: f.budget, timeoutMs: 150 });
      const input = { userId: f.userId, chatId: f.chat.id, requestId: `held-${phase}`, messages: f.prepared.messages, sourceSnapshots: f.prepared.sourceSnapshots! };
      const start = Date.now();
      await assert.rejects(service.execute(input), /超时/);
      assert.ok(Date.now() - start < 1000);
      const operation = await NoteDiscoveryChatTurn.findOne({ userId: f.userId, requestId: input.requestId });
      assert.ok(operation);
      await f.budget.recoverConversation(String(operation._id));
      assert.equal((await NoteDiscoveryChatTurn.findById(operation._id)).status, 'failed');
      resume(); stub.mock.restore();
      await assert.rejects(service.execute(input), /未完成/);
      assert.equal(f.scripted.calls.length, 0);
    }
  });
  it('bounds a hanging pre-send reservation acknowledgement and leaves recovery ownership intact', async () => {
    const f = await fixture();
    const { NoteDiscoveryConversationService } = await import('../services/noteDiscoveryConversationService');
    let release: () => void = () => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    const original = f.budget.reserveConversation.bind(f.budget);
    mock.method(f.budget, 'reserveConversation', async (...args: Parameters<typeof original>) => { const result = await original(...args); await held; return result; });
    const service = new NoteDiscoveryConversationService({ enabled: () => true, provider: f.provider, budget: f.budget, timeoutMs: 40 });
    const start = Date.now();
    await assert.rejects(service.execute({ userId: f.userId, chatId: f.chat.id, requestId: 'held', messages: f.prepared.messages, sourceSnapshots: f.prepared.sourceSnapshots! }), /超时/);
    assert.ok(Date.now() - start < 1000);
    const { NoteDiscoveryChatTurn } = await import('../models/NoteDiscoveryChatTurn');
    const turn = await NoteDiscoveryChatTurn.findOne({ userId: f.userId, requestId: 'held' });
    assert.equal(turn.status, 'running');
    release();
    await f.budget.recoverConversation(String(turn._id));
    assert.equal((await NoteDiscoveryChatTurn.findById(turn._id)).status, 'failed');
    assert.equal(f.scripted.calls.length, 0);
  });
  it('allows only explicit deterministic retry of confirmed pre-send budget denial', async () => {
    const f = await fixture();
    const { discoveryRetryRequestId } = await import('../services/noteDiscoveryConversationService');
    const { NoteDiscoveryChatTurn } = await import('../models/NoteDiscoveryChatTurn');
    const original = f.budget.reserveConversation.bind(f.budget);
    const denied = mock.method(f.budget, 'reserveConversation', async () => null);
    const input = {userId:f.userId,chatId:f.chat.id,requestId:'budget-denied',messages:f.prepared.messages,sourceSnapshots:f.prepared.sourceSnapshots!};
    await assert.rejects(f.service.execute(input), (e: any) => e.details?.retryEligible === true && e.details?.requestId === input.requestId);
    const prior = await NoteDiscoveryChatTurn.findOne({userId:f.userId,requestId:input.requestId});
    assert.equal(prior.status,'failed');assert.equal(prior.providerStartedAt,undefined);
    denied.mock.restore();
    await assert.rejects(f.service.execute(input), (e: any) => e.details?.retryEligible === true);
    assert.equal(f.scripted.calls.length,0,'budget recovery alone must not resend old ID');
    const retry = {...input,requestId:discoveryRetryRequestId(input.requestId),retryOfRequestId:input.requestId};
    const results = await Promise.allSettled([f.service.execute(retry),f.service.execute(retry)]);
    assert.ok(results.some(result=>result.status==='fulfilled'));
    await f.service.execute(retry);
    assert.equal(f.scripted.calls.length,1,'concurrent explicit retries and response-loss replay share one paid winner');
    assert.equal(await NoteDiscoveryChatTurn.countDocuments({userId:f.userId}),2);
    await assert.rejects(f.service.execute({...input,requestId:discoveryRetryRequestId(retry.requestId),retryOfRequestId:retry.requestId}), /尚不能重新申请/);
    assert.equal(typeof original,'function');
  });
  it('rejects explicit new attempts for unknown paid delivery', async () => {
    const f = await fixture();
    const { NoteDiscoveryChatTurn } = await import('../models/NoteDiscoveryChatTurn');
    const { discoveryRetryRequestId } = await import('../services/noteDiscoveryConversationService');
    await NoteDiscoveryChatTurn.create({userId:f.userId,chatId:f.chat.id,requestId:'unknown-retry',status:'failed',errorCode:'CHAT_GENERATION_FAILED',providerStartedAt:new Date(),generation:1,leaseToken:'test',leaseUntil:new Date(),payload:{messages:f.prepared.messages,sourceSnapshots:f.prepared.sourceSnapshots}});
    await assert.rejects(f.service.execute({userId:f.userId,chatId:f.chat.id,requestId:discoveryRetryRequestId('unknown-retry'),retryOfRequestId:'unknown-retry',messages:f.prepared.messages,sourceSnapshots:f.prepared.sourceSnapshots!}), /尚不能重新申请/);
    assert.equal(f.scripted.calls.length,0);
  });

});
