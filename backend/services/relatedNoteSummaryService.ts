import { Note } from '../models/Note';
import { ErrorHandler } from '../utils/errorHandler';
import { sourceMetadata } from './noteSourceMetadata';

type Source = { revision?: number; recommendCache?: any };

export function selectCurrentRelatedCandidateIds(source: Source): string[] {
  const cache = source.recommendCache;
  if (!cache || Number(cache.sourceRevision) !== Number(source.revision)) return [];
  const entries = cache.byCandidateId && typeof cache.byCandidateId === 'object' ? Object.entries(cache.byCandidateId) : [];
  return entries.slice(0, 5).map(([id]) => id);
}

export class RelatedNoteSummaryService {
  async list(userId: string, noteId: string) {
    const source = await Note.findOne({ _id: noteId, userId }).lean();
    if (!source) throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    const ids = selectCurrentRelatedCandidateIds(source);
    if (!ids.length) return [];
    const notes = await Note.find({ _id: { $in: ids }, userId }).lean();
    const byId = new Map(notes.map((note: any) => [String(note._id), note]));
    return ids.flatMap((id) => {
      const note: any = byId.get(id);
      if (!note) return [];
      const candidate = (source as any).recommendCache.byCandidateId[id] ?? {};
      const metadata = sourceMetadata(note);
      return [{
        noteId: id,
        title: typeof note.title === 'string' ? note.title : '',
        contentText: String(note.contentText || note.content || ''),
        excerpt: metadata.excerpt,
        sourceType: metadata.sourceType,
        imageCount: metadata.imageCount,
        firstImageSrc: metadata.firstImageSrc,
        createdAt: metadata.createdAt,
        type: typeof candidate.type === 'string' ? candidate.type : '',
        reason: typeof candidate.reason === 'string' ? candidate.reason : '',
        revision: typeof note.revision === 'number' ? note.revision : 1,
      }];
    });
  }
}

export const relatedNoteSummaryService = new RelatedNoteSummaryService();
