import { ErrorHandler } from '../utils/errorHandler';

const CURSOR_VERSION = 1;
const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

type NoteCursorPayload = {
  version: number;
  createdAt: string;
  id: string;
};

export type NoteListCursor = {
  createdAt: Date;
  id: string;
};

function invalidCursor(): never {
  throw ErrorHandler.createValidationError('笔记分页游标无效', { code: 'NOTE_CURSOR_INVALID' });
}

function isValidObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

function parseIsoDate(value: unknown): Date {
  if (typeof value !== 'string') return invalidCursor();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return invalidCursor();
  return date;
}

export function encodeNoteCursor(input: NoteListCursor): string {
  const createdAt = input.createdAt instanceof Date ? input.createdAt : invalidCursor();
  if (Number.isNaN(createdAt.getTime()) || !isValidObjectId(input.id)) invalidCursor();
  const payload: NoteCursorPayload = {
    version: CURSOR_VERSION,
    createdAt: createdAt.toISOString(),
    id: input.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeNoteCursor(value: string): NoteListCursor {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) invalidCursor();

  let parsed: unknown;
  try {
    const encoded = Buffer.from(value, 'base64url').toString('base64url');
    if (encoded !== value) invalidCursor();
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return invalidCursor();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) invalidCursor();
  const payload = parsed as Partial<NoteCursorPayload>;
  const keys = Object.keys(payload).sort();
  if (keys.length !== 3 || keys.join(',') !== 'createdAt,id,version' || payload.version !== CURSOR_VERSION || !isValidObjectId(payload.id)) {
    invalidCursor();
  }
  return { createdAt: parseIsoDate(payload.createdAt), id: payload.id };
}
