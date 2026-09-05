import { randomBytes } from 'node:crypto';
import PublishedNote from '../models/PublishedNote';
import { Note } from '../models/Note';
import User from '../models/User';
import { ErrorHandler } from '../utils/errorHandler';
import { sanitizeNoteSnapshot } from './publicSnapshot';

function id(value: any): string { return String(value?._id ?? value); }
function privateDto(value: any) {
  return { id: id(value), sourceNoteId: id(value.sourceNoteId), sourceRevision: value.sourceRevision, slug: value.slug, title: value.title, status: value.status, publishedAt: value.publishedAt, updatedAt: value.updatedAt, revokedAt: value.revokedAt };
}
function publicDto(value: any) {
  return { slug: value.slug, title: value.title, contentSnapshot: value.contentSnapshot, authorDisplayName: value.authorDisplayName, publishedAt: value.publishedAt, updatedAt: value.updatedAt };
}

class PublicationService {
  private slug() { return randomBytes(24).toString('base64url'); }

  async create(userId: string, noteId: string) {
    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    const user = await User.findById(userId);
    const publication = await PublishedNote.create({
      ownerUserId: userId, sourceNoteId: noteId, sourceRevision: (note as any).revision || 1, slug: this.slug(),
      title: (note as any).title || undefined, contentSnapshot: sanitizeNoteSnapshot(note as any),
      authorDisplayName: (user as any)?.username || undefined, status: 'active', publishedAt: new Date(),
    });
    return { ...privateDto(publication), contentSnapshot: (publication as any).contentSnapshot };
  }

  async list(userId: string) {
    const items = await PublishedNote.find({ ownerUserId: userId }).sort({ updatedAt: -1 }).lean();
    return (items as any[]).map(privateDto);
  }

  async refresh(userId: string, publicationId: string) {
    const publication = await PublishedNote.findOne({ _id: publicationId, ownerUserId: userId, status: 'active' });
    if (!publication) throw ErrorHandler.createNotFoundError('公开内容不存在或无权限');
    const note = await Note.findOne({ _id: (publication as any).sourceNoteId, userId });
    if (!note) throw ErrorHandler.createNotFoundError('笔记不存在或无权限');
    const updated = await PublishedNote.findOneAndUpdate(
      { _id: publicationId, ownerUserId: userId, status: 'active' },
      { $set: { sourceRevision: (note as any).revision || 1, title: (note as any).title || undefined, contentSnapshot: sanitizeNoteSnapshot(note as any) } },
      { new: true },
    );
    return privateDto(updated || publication);
  }

  async revoke(userId: string, publicationId: string) {
    const result = await PublishedNote.updateOne({ _id: publicationId, ownerUserId: userId, status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date() } });
    if (!result.matchedCount) throw ErrorHandler.createNotFoundError('公开内容不存在或无权限');
  }

  async getPublic(slug: string) {
    const publication = await PublishedNote.findOne({ slug, status: 'active' });
    if (!publication) throw ErrorHandler.createNotFoundError('内容不可用');
    return publicDto(publication);
  }
}
export const publicationService = new PublicationService();

