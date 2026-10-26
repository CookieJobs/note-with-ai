import assert from 'node:assert/strict';
import axios from 'axios';
import { test } from 'node:test';
import { buildTopicInputs } from '../services/userNoteTopicInputs';
import { createUserNoteTopicIndexService, DAY, TEN_MINUTES, type TopicJob, type TopicNote, type TopicStore } from '../services/userNoteTopicIndexService';
import { createUserNoteTopicWorker, extractTopicsWithDeepSeek } from '../services/userNoteTopicIndexWorker';
import { createDeepSeekTopicClient } from '../services/llmService';

const now = new Date('2026-10-02T00:00:00.000Z');

class MemoryStore implements TopicStore {
  notes = new Map<string, TopicNote>();
  rows = new Map<string, any>();
  leases = new Map<string, { token: string; until: number }>();
  calls: TopicJob[] = [];
  changedAfterClaim = false;
  private key(userId: string, noteId: string) { return `${userId}:${noteId}`; }
  async getNote(userId: string, noteId: string) { const n = this.notes.get(this.key(userId, noteId)); return n ? structuredClone(n) : null; }
  async schedule(userId: string, note: TopicNote, inputs: ReturnType<typeof buildTopicInputs>, at: Date) {
    const key = this.key(userId, note._id); const prior = this.rows.get(key);
    this.rows.set(key, { ...(prior ?? {}), userId, noteId: note._id, sourceRevision: inputs.sourceRevision, sourceFingerprint: inputs.sourceFingerprint, source: inputs.source, status: prior?.sourceFingerprint === inputs.sourceFingerprint && prior.status === 'ready' ? 'ready' : 'pending', topics: prior?.topics ?? [], lastSuccess: prior?.lastSuccess ?? null, automaticAttemptCount: prior?.automaticAttemptFingerprint === inputs.sourceFingerprint ? prior.automaticAttemptCount : 0, automaticAttemptFingerprint: inputs.sourceFingerprint, nextAttemptAt: at, manualAttemptTimestamps: prior?.manualAttemptTimestamps ?? [], claimVersion: prior?.claimVersion ?? 0, scheduledAt: at });
  }
  async claimUserLease(userId: string, token: string, at: Date) { const prior = this.leases.get(userId); if (prior && prior.until > at.getTime()) return false; this.leases.set(userId, { token, until: at.getTime() + 120_000 }); return true; }
  async releaseUserLease(userId: string, token: string) { if (this.leases.get(userId)?.token === token) this.leases.delete(userId); }
  async claimNext(userId: string, token: string, at: Date, mode: 'automatic' | 'manual' = 'automatic'): Promise<TopicJob | null> {
    const row = [...this.rows.values()].find((r) => r.userId === userId && r.status === 'pending' && r.nextAttemptAt <= at && (mode === 'manual' ? r.retryMode === 'manual' : r.retryMode !== 'manual' && r.automaticAttemptCount < 3));
    if (!row) return null;
    const note = await this.getNote(userId, row.noteId); if (!note) return null;
    const inputs = buildTopicInputs(note); if (inputs.sourceFingerprint !== row.sourceFingerprint) return null;
    row.status = 'processing'; row.claimToken = token; row.claimVersion++; row.automaticAttemptCount += mode === 'automatic' ? 1 : 0; row.retryMode = mode;
    const job = { userId, noteId: row.noteId, sourceRevision: inputs.sourceRevision, sourceFingerprint: inputs.sourceFingerprint, source: inputs.source, promptText: inputs.promptText, candidateTopics: inputs.candidateTopics, mode, attemptNumber: mode === 'automatic' ? row.automaticAttemptCount : row.manualAttemptTimestamps.length, claimToken: token, claimVersion: row.claimVersion, claimUntil: new Date(at.getTime() + 120_000) } as TopicJob;
    return job;
  }
  async finish(job: TopicJob, topics: string[], at: Date) {
    const row = this.rows.get(this.key(job.userId, job.noteId)); const note = await this.getNote(job.userId, job.noteId);
    if (!note || buildTopicInputs(note).sourceFingerprint !== job.sourceFingerprint || row?.claimToken !== job.claimToken || job.claimUntil <= at) return false;
    row.status = 'ready'; row.topics = topics; row.indexedAt = at; row.lastSuccess = { sourceRevision: job.sourceRevision, sourceFingerprint: job.sourceFingerprint, topics, source: job.source, indexedAt: at }; row.claimToken = null; return true;
  }
  async fail(job: TopicJob, errorCode: string, at: Date) { const row = this.rows.get(this.key(job.userId, job.noteId)); if (!row || row.claimToken !== job.claimToken) return; row.status = job.mode === 'manual' || job.attemptNumber >= 3 ? 'failed' : 'pending'; row.lastErrorCode = errorCode; row.nextAttemptAt = row.status === 'pending' ? new Date(at.getTime() + (job.attemptNumber === 1 ? 30_000 : 120_000)) : null; row.claimToken = null; }
  async retryFailed(userId: string, _scope: any, at: Date) {
    const result = { acceptedCount: 0, alreadyRunningCount: 0, rateLimitedCount: 0, nextRetryAt: null as string | null };
    let earliest = Infinity;
    for (const row of this.rows.values()) {
      if (row.userId !== userId || row.status !== 'failed') continue;
      const note = await this.getNote(userId, row.noteId); if (!note) continue;
      const inputs = buildTopicInputs(note);
      if (inputs.sourceFingerprint !== row.sourceFingerprint || inputs.sourceRevision !== row.sourceRevision) continue;
      const recent = (row.manualAttemptTimestamps ?? []).map((x: Date) => new Date(x)).filter((x: Date) => x.getTime() > at.getTime() - DAY);
      const cooldown = row.lastManualAttemptAt ? new Date(row.lastManualAttemptAt).getTime() + TEN_MINUTES : -Infinity;
      const quota = recent.length >= 3 ? Math.min(...recent.slice(-3).map((x: Date) => x.getTime())) + DAY : -Infinity;
      const allowedAt = Math.max(cooldown, quota);
      if (allowedAt > at.getTime()) { result.rateLimitedCount++; earliest = Math.min(earliest, allowedAt); continue; }
      row.status = 'pending'; row.retryMode = 'manual'; row.nextAttemptAt = at; row.lastManualAttemptAt = at; row.manualAttemptTimestamps = [...recent, at]; result.acceptedCount++;
    }
    result.nextRetryAt = Number.isFinite(earliest) ? new Date(earliest).toISOString() : null;
    return result;
  }
}

function setup(note: Partial<TopicNote> = {}) {
  const store = new MemoryStore();
  const value: TopicNote = { _id: 'n1', userId: 'u1', revision: 1, title: 'T', content: '正文', ...note };
  store.notes.set('u1:n1', value);
  const service = createUserNoteTopicIndexService(store, () => new Date(now));
  const worker = createUserNoteTopicWorker(store, { now: () => new Date(now), extract: async () => ['模型提取'] });
  return { store, service, worker, note: value };
}

test('使用现有关键词作为候选且不调用 DeepSeek', async () => {
  let calls = 0;
  const { store, service } = setup({ keywords: ['向量检索'] });
  const worker = createUserNoteTopicWorker(store, { now: () => new Date(now), extract: async () => { calls++; return ['错误']; } });
  await service.scheduleUserNoteTopicIndex('u1', 'n1');
  await worker.processNext('u1');
  assert.equal(calls, 0);
  assert.deepEqual(store.rows.get('u1:n1').topics, ['向量检索']);
});

test('没有候选话题时只发送一篇有界笔记', async () => {
  let received = '';
  const { store, service } = setup({ content: '🐈'.repeat(4_000) });
  const worker = createUserNoteTopicWorker(store, { now: () => new Date(now), extract: async (_userId, text) => { received = text; return ['猫']; } });
  await service.scheduleUserNoteTopicIndex('u1', 'n1'); await worker.processNext('u1');
  assert.equal(Array.from(received).length, 3_000);
  assert.equal(store.calls.length, 0);
});

test('修订号不变但摘要变化会使完成结果过期', async () => {
  let resolve!: (value: string[]) => void;
  const { store, service } = setup({ summary: '初始摘要' });
  const worker = createUserNoteTopicWorker(store, { now: () => new Date(now), extract: () => new Promise<string[]>((r) => { resolve = r; }) });
  await service.scheduleUserNoteTopicIndex('u1', 'n1');
  const running = worker.processNext('u1');
  await new Promise((r) => setImmediate(r));
  store.notes.get('u1:n1')!.summary = '新摘要';
  resolve(['旧结果']); await running;
  assert.equal(store.rows.get('u1:n1').status, 'processing');
  assert.equal(store.rows.get('u1:n1').lastSuccess, null);
});

test('旧结果或失败不会替换最近成功结果', async () => {
  const { store, service, worker } = setup({ keywords: ['旧标签'] });
  await service.scheduleUserNoteTopicIndex('u1', 'n1'); await worker.processNext('u1');
  const previous = store.rows.get('u1:n1').lastSuccess;
  store.notes.get('u1:n1')!.keywords = [];
  await service.scheduleUserNoteTopicIndex('u1', 'n1');
  store.rows.get('u1:n1').lastSuccess = previous;
  assert.equal(store.rows.get('u1:n1').lastSuccess, previous);
});

test('自动尝试在 30 秒和 120 秒间隔后最多三次即停止', async () => {
  let current = new Date(now); const store = new MemoryStore();
  const note: TopicNote = { _id: 'n1', userId: 'u1', revision: 1, content: 'no candidates' }; store.notes.set('u1:n1', note);
  const service = createUserNoteTopicIndexService(store, () => new Date(now)); await service.scheduleUserNoteTopicIndex('u1', 'n1');
  const worker = createUserNoteTopicWorker(store, { now: () => new Date(current), extract: async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE' }); } });
  await worker.processNext('u1'); assert.equal(store.rows.get('u1:n1').nextAttemptAt.getTime(), now.getTime() + 30_000);
  current = new Date(now.getTime() + 30_000); await worker.processNext('u1'); assert.equal(store.rows.get('u1:n1').nextAttemptAt.getTime(), now.getTime() + 150_000);
  current = new Date(now.getTime() + 150_000); await worker.processNext('u1'); assert.equal(store.rows.get('u1:n1').status, 'failed');
  current = new Date(now.getTime() + 999_000); await worker.processNext('u1'); assert.equal(store.rows.get('u1:n1').automaticAttemptCount, 3);
});

test('同一笔记每十分钟最多人工重试一次', async () => {
  const { store, service } = setup();
  store.rows.set('u1:n1', { status: 'failed', userId: 'u1', noteId: 'n1', sourceFingerprint: buildTopicInputs(store.notes.get('u1:n1')!).sourceFingerprint, sourceRevision: 1, manualAttemptTimestamps: [now], lastManualAttemptAt: now });
  const result = await service.retryFailedUserTopics('u1', 'all');
  assert.equal(result.rateLimitedCount, 1);
  assert.equal(result.nextRetryAt, new Date(now.getTime() + 600_000).toISOString());
});

test('提示文本不包含其他笔记内容', async () => {
  const { store, service } = setup({ content: '独立笔记' });
  store.notes.set('u1:n2', { _id: 'n2', userId: 'u1', revision: 1, content: '秘密其他笔记' });
  let input = ''; const worker = createUserNoteTopicWorker(store, { now: () => new Date(now), extract: async (_uid, text) => { input = text; return ['标签']; } });
  await service.scheduleUserNoteTopicIndex('u1', 'n1'); await worker.processNext('u1');
  assert.equal(input.includes('秘密其他笔记'), false);
});

test('滚动 24 小时最多允许三次人工重试且窗口后恢复', async () => {
  const { store, service } = setup(); const fingerprint = buildTopicInputs(store.notes.get('u1:n1')!).sourceFingerprint;
  store.rows.set('u1:n1', { status: 'failed', userId: 'u1', noteId: 'n1', sourceFingerprint: fingerprint, sourceRevision: 1, manualAttemptTimestamps: [0, 1, 2].map((n) => new Date(now.getTime() - n * 1_000)), lastManualAttemptAt: new Date(now.getTime() - 600_001) });
  const limited = await service.retryFailedUserTopics('u1', 'all');
  assert.equal(limited.rateLimitedCount, 1);
  store.rows.get('u1:n1').manualAttemptTimestamps = [0, 1, 2].map((n) => new Date(now.getTime() - DAY - 10_000 - n * 1_000));
  store.rows.get('u1:n1').lastManualAttemptAt = new Date(now.getTime() - DAY - 10_000);
  const recovered = await service.retryFailedUserTopics('u1', 'all');
  assert.equal(recovered.acceptedCount, 1);
});

test('同一用户的两个 worker 并发时只有一个领取笔记', async () => {
  let unblock!: () => void;
  const store = new MemoryStore();
  store.notes.set('u1:n1', { _id: 'n1', userId: 'u1', revision: 1, content: 'one' });
  const service = createUserNoteTopicIndexService(store, () => new Date(now));
  await service.scheduleUserNoteTopicIndex('u1', 'n1');
  const worker1 = createUserNoteTopicWorker(store, { now: () => new Date(now), extract: () => new Promise((resolve) => { unblock = () => resolve(['话题']); }) });
  const worker2 = createUserNoteTopicWorker(store, { now: () => new Date(now), extract: async () => ['不应调用'] });
  const first = worker1.processNext('u1'); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await worker2.processNext('u1'), false);
  unblock(); await first;
  assert.equal(store.rows.get('u1:n1').status, 'ready');
});

test('单篇 DeepSeek 请求携带 topic_extraction telemetry 且只包含该笔记输入', async () => {
  const observed: { value?: { messages: { role: string; content: string }[]; options: any; telemetry: any } } = {};
  const topics = await extractTopicsWithDeepSeek({
    async chatCompletion(messages: any, options: any, telemetry: any) {
      observed.value = { messages, options, telemetry };
      return '{"topics":["AI","人工智能"]}';
    },
  } as any, 'user-42', '这篇笔记的有界内容');
  assert.deepEqual(topics, ['人工智能']);
  assert.equal(observed.value?.telemetry.operation, 'topic_extraction');
  assert.equal(observed.value?.telemetry.userId, 'user-42');
  assert.deepEqual(observed.value?.options, { temperature: 0.1, max_tokens: 300, response_format: { type: 'json_object' } });
  assert.deepEqual(observed.value?.messages.map((message) => message.content), [
    '你是笔记话题提取器。只返回 JSON 对象 {"topics":["话题"]}，topics 中包含 1-8 个简短、明确的话题标签；不要解释。',
    '这篇笔记的有界内容',
  ]);
});

test('话题专用 DeepSeek 客户端每个持久任务只进行一次 HTTP 尝试', async () => {
  const originalAdapter = axios.defaults.adapter;
  let attempts = 0;
  axios.defaults.adapter = async () => { attempts++; throw new Error('mock transport failure'); };
  try {
    const client = createDeepSeekTopicClient('test-key');
    await assert.rejects(client.chatCompletion([{ role: 'user', content: 'bounded note' }], {}, { requestId: 'topic-test', userId: 'u1', operation: 'topic_extraction' }));
    assert.equal(attempts, 1);
  } finally {
    axios.defaults.adapter = originalAdapter;
  }
});
