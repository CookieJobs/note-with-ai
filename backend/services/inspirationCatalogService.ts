import mongoose from 'mongoose';
import InspirationItem from '../models/InspirationItem';
import { ErrorHandler } from '../utils/errorHandler';
import { toInspirationDto, type InspirationDto } from './inspirationTypes';

export type InspirationView = 'recent' | 'saved' | 'dismissed';
type Cursor = { v: 1; view: InspirationView; at: string; id: string };
const idPattern = /^[0-9a-f]{24}$/i;

function validId(value: string): boolean {
  return idPattern.test(value) && mongoose.isValidObjectId(value);
}

function readCursor(value: string | null, view: InspirationView): Cursor | null {
  if (value === null) return null;
  if (value.length === 0 || value.length > 512 || !/^[\w-]+$/.test(value)) {
    throw ErrorHandler.createValidationError('无效的灵感翻页位置');
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid cursor');
    const cursor = parsed as Partial<Cursor>;
    if (cursor.v !== 1 || cursor.view !== view || typeof cursor.at !== 'string'
      || Number.isNaN(Date.parse(cursor.at)) || new Date(cursor.at).toISOString() !== cursor.at
      || typeof cursor.id !== 'string' || !validId(cursor.id)) throw new Error('invalid cursor');
    return cursor as Cursor;
  } catch {
    throw ErrorHandler.createValidationError('无效的灵感翻页位置');
  }
}

function encodeCursor(item: Record<string, unknown>, view: InspirationView): string {
  const date = (view === 'recent' ? item.createdAt : item.userStateChangedAt) as Date;
  return Buffer.from(JSON.stringify({ v: 1, view, at: date.toISOString(), id: String(item._id) })).toString('base64url');
}

export class InspirationCatalogService {
  async list(userId: string, view: InspirationView, cursorValue: string | null): Promise<{ items: InspirationDto[]; nextCursor: string | null }> {
    if (!['recent', 'saved', 'dismissed'].includes(view)) {
      throw ErrorHandler.createValidationError('无效的灵感视图');
    }
    const cursor = readCursor(cursorValue, view);
    const sortField = view === 'recent' ? 'createdAt' : 'userStateChangedAt';
    const filter: Record<string, unknown> = {
      userId, status: 'completed',
      userState: view === 'recent' ? { $ne: 'dismissed' } : view,
    };
    if (cursor) {
      const at = new Date(cursor.at);
      const itemId = new mongoose.Types.ObjectId(cursor.id);
      filter.$or = [
        { [sortField]: { $lt: at } },
        { [sortField]: at, _id: { $lt: itemId } },
      ];
    }
    const page = await InspirationItem.find(filter)
      .sort({ [sortField]: -1, _id: -1 }).limit(21).lean() as unknown as Array<Record<string, unknown>>;
    return {
      items: page.slice(0, 20).map(toInspirationDto),
      nextCursor: page.length > 20 ? encodeCursor(page[19], view) : null,
    };
  }

  async detail(userId: string, id: string): Promise<InspirationDto> {
    if (!validId(id)) throw ErrorHandler.createNotFoundError('灵感不存在');
    const item = await InspirationItem.findOne({ _id: id, userId, status: 'completed' }).lean();
    if (!item) throw ErrorHandler.createNotFoundError('灵感不存在');
    return toInspirationDto(item as Record<string, unknown>);
  }

  async latest(userId: string): Promise<InspirationDto | null> {
    const item = await InspirationItem.findOne({ userId, status: 'completed', userState: { $ne: 'dismissed' } })
      .sort({ createdAt: -1, _id: -1 }).lean();
    return item ? toInspirationDto(item as Record<string, unknown>) : null;
  }
}

export const inspirationCatalogService = new InspirationCatalogService();
