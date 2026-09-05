import InspirationItem from '../models/InspirationItem';
import InspirationJob from '../models/InspirationJob';
import InspirationSettings from '../models/InspirationSettings';
import NoteAiPreference from '../models/NoteAiPreference';
import { Note } from '../models/Note';
import { searchProvider, isSearchProviderConfigured } from './search';
import { AppError, ErrorHandler, ErrorType } from '../utils/errorHandler';
import { trackProductEventBestEffort } from './productEventService';

function minimize(value: string) {
  return value.replace(/[\w.+-]+@[\w.-]+/g, '').replace(/https?:\/\/\S+/g, '').replace(/[@#][\w-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}
class InspirationService {
  async request(userId: string, trigger: 'manual' | 'proactive' = 'manual') {
    if (!isSearchProviderConfigured()) throw new AppError('目前无法寻找新灵感', ErrorType.EXTERNAL_API, 503, true, { code: 'SEARCH_PROVIDER_UNAVAILABLE' });
    const active = await InspirationJob.findOne({ userId, status: { $in: ['queued', 'running'] } });
    if (active) throw ErrorHandler.createValidationError('已有灵感任务在进行中');
    const job = await InspirationJob.create({ userId, trigger, status: 'queued' });
    setImmediate(() => { void this.run(String((job as any)._id), userId); });
    return { jobId: String((job as any)._id), status: 'queued' as const };
  }
  async run(jobId: string, userId: string) {
    try {
      await InspirationJob.updateOne({ _id: jobId, userId, status: 'queued' }, { $set: { status: 'running' } });
      const excluded = await NoteAiPreference.find({ userId, included: false }).select('noteId').lean();
      const excludedIds = (excluded as any[]).map((item) => item.noteId);
      const notes = await Note.find({ userId, _id: { $nin: excludedIds } }).sort({ updatedAt: -1 }).limit(10).lean();
      const note = (notes as any[]).find((item) => minimize(String(item.title || (item.keywords || []).join(' '))));
      if (!note) return this.finish(jobId, 'no_result');
      const topic = minimize(String(note.title || (note.keywords || []).join(' ')));
      if (!topic) return this.finish(jobId, 'no_result');
      const results = await searchProvider.search(topic, { limit: 5 });
      const result = results.find((item) => Boolean(item.snippet));
      if (!result?.snippet) return this.finish(jobId, 'no_result');
      const duplicate = await InspirationItem.findOne({ userId, 'source.canonicalUrl': result.url });
      if (duplicate) return this.finish(jobId, 'no_result');
      const item = await InspirationItem.create({
        userId,
        relatedNotes: [{ noteId: note._id, noteRevision: note.revision || 1, reason: `与你近期记录的主题“${topic.slice(0, 40)}”有关` }],
        source: { canonicalUrl: result.url, title: result.title, publisher: result.publisher || new URL(result.url).hostname, publishedAt: result.publishedAt, retrievedAt: new Date(), evidenceType: 'provider_snippet' },
        summary: result.snippet.slice(0, 1000),
        whyThis: `这篇内容与近期记录的“${topic.slice(0, 40)}”相关。根据搜索摘要整理。`,
      });
      await InspirationJob.updateOne({ _id: jobId, userId }, { $set: { status: 'completed', itemId: item._id, completedAt: new Date() } });
      trackProductEventBestEffort({ name: 'inspiration_generated', userId, source: 'server', properties: {} });
    } catch (error: any) {
      await InspirationJob.updateOne({ _id: jobId, userId }, { $set: { status: 'failed', failureCode: error?.details?.code || 'INSPIRATION_FAILED', completedAt: new Date() } });
      trackProductEventBestEffort({ name: 'inspiration_generation_failed', userId, source: 'server', properties: {} });
    }
  }
  private async finish(jobId: string, status: 'no_result') { await InspirationJob.updateOne({ _id: jobId }, { $set: { status, completedAt: new Date() } }); }
  async list(userId: string) {
    const excluded = await NoteAiPreference.find({ userId, included: false }).select('noteId').lean();
    const excludedIds = new Set((excluded as any[]).map((item) => String(item.noteId)));
    const items = await InspirationItem.find({ userId, status: { $ne: 'dismissed' } }).sort({ updatedAt: -1 }).limit(20).lean();
    return (items as any[]).filter((item) => (item.relatedNotes || []).some((note: any) => !excludedIds.has(String(note.noteId))));
  }
  async job(userId: string, jobId: string) {
    const job = await InspirationJob.findOne({ _id: jobId, userId }).lean();
    if (!job) throw ErrorHandler.createNotFoundError('灵感任务不存在或无权限');
    return { id: String((job as any)._id), status: (job as any).status, itemId: (job as any).itemId ? String((job as any).itemId) : undefined };
  }
  async updateStatus(userId: string, id: string, status: 'read'|'saved'|'dismissed') {
    const item = await InspirationItem.findOneAndUpdate({ _id: id, userId }, { $set: { status } }, { new: true });
    if (!item) throw ErrorHandler.createNotFoundError('灵感不存在或无权限');
    return item;
  }
  async settings(userId: string) {
    const value = await InspirationSettings.findOne({ userId }).lean();
    return { proactiveEnabled: Boolean((value as any)?.proactiveEnabled) };
  }
  async saveSettings(userId: string, proactiveEnabled: boolean) {
    await InspirationSettings.findOneAndUpdate({ userId }, { $set: { proactiveEnabled } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    return { proactiveEnabled };
  }
}
export const inspirationService = new InspirationService();
