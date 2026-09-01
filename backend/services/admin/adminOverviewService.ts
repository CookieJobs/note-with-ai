import mongoose from 'mongoose';
import User from '../../models/User';
import { Note } from '../../models/Note';
import Chat from '../../models/Chat';
import ProductEvent from '../../models/ProductEvent';
import AiUsageEvent from '../../models/AiUsageEvent';

export type OverviewRange = '7d' | '30d';
type Bucket = { day: string; value: number };

const shanghaiDay = (date: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const startOfShanghaiDay = (now: Date): Date => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - 8 * 60 * 60 * 1000);
};
const rangeDays = (range: OverviewRange): number => {
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  throw new Error('range must be 7d or 30d');
};
const buckets = (now: Date, days: number): Bucket[] => {
  const end = startOfShanghaiDay(now);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end.getTime() - (days - 1 - index) * 86400000);
    return { day: shanghaiDay(date), value: 0 };
  });
};
async function aggregate(model: any, pipeline: unknown[]): Promise<any[]> {
  return model.aggregate(pipeline as any);
}
function fill(rows: any[], expected: Bucket[]): Bucket[] {
  const values = new Map(rows.map((row) => [String(row._id ?? row.day), Number(row.value ?? row.count ?? 0)]));
  return expected.map((bucket) => ({ ...bucket, value: values.get(bucket.day) ?? 0 }));
}
function failedCount(rows: any[]): number { return Number(rows.find((row) => row.failed !== undefined)?.failed ?? 0); }

export async function getOverview(input: { range: OverviewRange; now?: Date }) {
  const now = input.now ?? new Date();
  const days = rangeDays(input.range);
  const start = new Date(startOfShanghaiDay(now).getTime() - (days - 1) * 86400000);
  const expected = buckets(now, days);
  const [users, notes, chats, events, ai] = await Promise.all([
    aggregate(User, [{ $facet: { total: [{ $count: 'value' }], todayNew: [{ $match: { createdAt: { $gte: startOfShanghaiDay(now), $lt: new Date(startOfShanghaiDay(now).getTime() + 86400000) } }, $count: 'value' }], activation: [{ $match: { activated: true } }, { $count: 'value' }] } }]),
    aggregate(Note, [{ $facet: { total: [{ $count: 'value' }], timeseries: [{ $match: { createdAt: { $gte: start } } }, { $project: { createdAt: 1 } }, { $group: { _id: { $dateToString: { date: '$createdAt', timezone: 'Asia/Shanghai', format: '%Y-%m-%d' } }, value: { $sum: 1 } } }], failed: [{ $project: { enrichment: 1 } }, { $project: { count: { $size: { $filter: { input: { $objectToArray: '$enrichment' }, as: 'artifact', cond: { $eq: ['$$artifact.v.status', 'failed'] } } } } } }, { $group: { _id: null, failed: { $sum: '$count' } } }] } }]),
    aggregate(Chat, [{ $facet: { total: [{ $count: 'value' }] } }]),
    aggregate(ProductEvent, [{ $match: { occurredAt: { $gte: start } } }, { $facet: { active: [{ $match: { name: 'user_active_day' } }, { $group: { _id: null, users: { $addToSet: '$userId' } } }], timeseries: [{ $match: { name: { $in: ['note_created', 'chat_turn_committed'] } } }, { $group: { _id: { day: { $dateToString: { date: '$occurredAt', timezone: 'Asia/Shanghai', format: '%Y-%m-%d' } }, name: '$name' }, value: { $sum: 1 } } }] } }]),
    aggregate(AiUsageEvent, [{ $match: { startedAt: { $gte: start } } }, { $facet: { summary: [{ $group: { _id: null, succeeded: { $sum: { $cond: [{ $eq: ['$status', 'succeeded'] }, 1, 0] } }, total: { $sum: 1 }, inputKnown: { $sum: { $cond: [{ $ne: ['$inputTokens', null] }, 1, 0] } }, outputKnown: { $sum: { $cond: [{ $ne: ['$outputTokens', null] }, 1, 0] } }, inputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } }, outputTokens: { $sum: { $ifNull: ['$outputTokens', 0] } } } }] } }]),
  ]);
  const userSummary = users[0] ?? {};
  const noteSummary = notes[0] ?? {};
  const chatSummary = chats[0] ?? {};
  const eventSummary = events.find((row) => row.dau !== undefined || row.active !== undefined) ?? events[0] ?? {};
  const aiSummary = ai[0]?.summary?.[0] ?? ai.find((row) => row.succeeded !== undefined) ?? {};
  const totalSucceededCalls = Number(aiSummary.succeeded ?? 0);
  const totalAiCalls = Number(aiSummary.total ?? 0);
  const tokenKnownCalls = Math.max(Number(aiSummary.inputKnown ?? 0), Number(aiSummary.outputKnown ?? 0));
  const aiRate = totalAiCalls ? totalSucceededCalls / totalAiCalls : null;
  const retention = { d1: null as number | null, d7: null as number | null, d30: null as number | null };
  const tokenCoverage = { knownCalls: tokenKnownCalls, totalSucceededCalls, inputTokens: Number(aiSummary.inputTokens ?? 0), outputTokens: Number(aiSummary.outputTokens ?? 0), rate: totalSucceededCalls ? tokenKnownCalls / totalSucceededCalls : null };
  const costCoverage = { knownCalls: 0, totalCalls: totalSucceededCalls, rate: null as number | null, estimatedCostMicros: null as number | null, currency: 'CNY' as const };
  const noteTimeseries = fill(noteSummary.timeseries ?? notes.filter((row) => row._id), expected);
  return {
    summary: { totalUsers: Number(userSummary.total?.[0]?.value ?? userSummary.total ?? 0), todayNewUsers: Number(userSummary.todayNew?.[0]?.value ?? 0), dau: Number(eventSummary.dau ?? eventSummary.active?.[0]?.users?.length ?? 0), wau: Number(eventSummary.wau ?? eventSummary.active?.[0]?.users?.length ?? 0), mau: Number(eventSummary.mau ?? eventSummary.active?.[0]?.users?.length ?? 0), activationUsers: Number(userSummary.activation?.[0]?.value ?? 0), totalNotes: Number(noteSummary.total?.[0]?.value ?? noteSummary.total ?? 0), totalChats: Number(chatSummary.total?.[0]?.value ?? chatSummary.total ?? 0), aiSuccessRate: aiRate, failedArtifacts: failedCount(noteSummary.failed ? noteSummary.failed : notes) },
    timeseries: noteTimeseries,
    retention,
    tokenCoverage,
    costCoverage,
    coverage: { tokens: { ...tokenCoverage }, cost: { ...costCoverage } },
  };
}

export async function getSystemHealth() {
  const since = new Date(Date.now() - 86400000);
  const [notes, ai] = await Promise.all([
    aggregate(Note, [{ $project: { enrichment: 1 } }, { $project: { count: { $size: { $filter: { input: { $objectToArray: '$enrichment' }, as: 'artifact', cond: { $eq: ['$$artifact.v.status', 'failed'] } } } } } }, { $group: { _id: null, failed: { $sum: '$count' } } }]),
    aggregate(AiUsageEvent, [{ $match: { startedAt: { $gte: since } } }, { $group: { _id: null, succeeded: { $sum: { $cond: [{ $eq: ['$status', 'succeeded'] }, 1, 0] } }, total: { $sum: 1 } } }]),
  ]);
  const row = ai[0] ?? {};
  return { mongo: { readyState: ({ 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' } as Record<number, string>)[mongoose.connection.readyState] ?? 'unknown' }, uptimeSeconds: Math.floor(process.uptime()), applicationVersion: process.env.npm_package_version || '1.0.0', failedArtifacts: failedCount(notes), aiSuccessRate24h: Number(row.total) ? Number(row.succeeded ?? 0) / Number(row.total) : null };
}
