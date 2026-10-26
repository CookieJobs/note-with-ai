import { randomUUID } from 'node:crypto';
import { AiUsageService } from './aiUsageService';
import { getDeepSeekTopicClient } from './llmService';
import type { DeepSeekApiClient } from '../utils/apiClient';
import type { TopicJob, TopicStore } from './userNoteTopicIndexService';
import { LEASE_MS } from './userNoteTopicIndexService';
import { normalizeTopicLabel } from './userNoteTopicInputs';

const SYSTEM_PROMPT = '你是笔记话题提取器。只返回 JSON 对象 {"topics":["话题"]}，topics 中包含 1-8 个简短、明确的话题标签；不要解释。';
let activeCalls = 0;
const waiters: Array<() => void> = [];

async function withDeepSeekSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeCalls < 2) activeCalls++;
  else await new Promise<void>((resolve) => waiters.push(resolve));
  try { return await fn(); }
  finally {
    const next = waiters.shift();
    if (next) next();
    else activeCalls--;
  }
}

function parseTopics(reply: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(reply); }
  catch { throw Object.assign(new Error('Topic extraction returned invalid JSON'), { code: 'TOPIC_RESPONSE_INVALID' }); }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { topics?: unknown }).topics)) {
    throw Object.assign(new Error('Topic extraction returned invalid JSON'), { code: 'TOPIC_RESPONSE_INVALID' });
  }
  const values = (parsed as { topics: unknown[] }).topics;
  if (values.length > 8 || values.some((value) => typeof value !== 'string')) {
    throw Object.assign(new Error('Topic extraction returned invalid topics'), { code: 'TOPIC_RESPONSE_INVALID' });
  }
  return [...new Set(values.map((value) => normalizeTopicLabel(value as string)).filter(Boolean))];
}

export interface TopicWorkerDependencies {
  now?: () => Date;
  extract?: (userId: string, promptText: string) => Promise<string[]>;
  token?: () => string;
}

async function defaultExtract(userId: string, promptText: string): Promise<string[]> {
  return extractTopicsWithDeepSeek(getDeepSeekTopicClient(), userId, promptText);
}

export async function extractTopicsWithDeepSeek(
  client: Pick<DeepSeekApiClient, 'chatCompletion'>,
  userId: string,
  promptText: string,
): Promise<string[]> {
  const text = await client.chatCompletion([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: promptText },
  ], { temperature: 0.1, max_tokens: 300, response_format: { type: 'json_object' } },
  AiUsageService.newContext('topic_extraction', userId));
  return parseTopics(text);
}

export function createUserNoteTopicWorker(store: TopicStore, dependencies: TopicWorkerDependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const extract = dependencies.extract ?? defaultExtract;
  const tokenFactory = dependencies.token ?? randomUUID;
  return {
    async processNext(userId: string): Promise<boolean> {
      return withDeepSeekSlot(async () => {
      const token = tokenFactory();
      const started = now();
      if (!await store.claimUserLease(userId, token, started)) return false;
      try {
        let job = await store.claimNext(userId, token, started, 'automatic');
        if (!job) job = await store.claimNext(userId, token, started, 'manual');
        if (!job) return false;
        try {
          const extracted = job.candidateTopics.length
            ? job.candidateTopics
            : await extract(job.userId, job.promptText);
          const topics = [...new Set(extracted.map(normalizeTopicLabel).filter(Boolean))];
          await store.finish(job, topics, now());
        } catch (error: unknown) {
          const code = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : 'AI_PROVIDER_FAILED';
          await store.fail(job, code, now());
        }
        return true;
      } finally {
        await store.releaseUserLease(userId, token);
      }
      });
    },
    leaseDurationMs: LEASE_MS,
  };
}

export const USER_TOPIC_DEEPSEEK_CONCURRENCY = 2;
export type { TopicJob };
