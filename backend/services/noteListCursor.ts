import { ErrorHandler } from '../utils/errorHandler';

export type NoteCursor = {
  createdAt: Date;
  id: string;
};

export function encodeNoteCursor(cursor: NoteCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeNoteCursor(value: string): NoteCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const createdAt = new Date(String(parsed?.createdAt));
    const id = typeof parsed?.id === 'string' ? parsed.id : '';
    if (!id || Number.isNaN(createdAt.getTime())) throw new Error('invalid');
    return { createdAt, id };
  } catch {
    throw ErrorHandler.createValidationError('分页 cursor 无效');
  }
}

