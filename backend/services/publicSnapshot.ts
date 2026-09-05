export type SanitizedRichText = {
  type: 'doc';
  content: SanitizedNode[];
};

export type SanitizedNode = {
  type: string;
  text?: string;
  attrs?: Record<string, string | number | boolean>;
  marks?: Array<{ type: string; attrs?: { href: string } }>;
  content?: SanitizedNode[];
};

type NoteLike = {
  title?: unknown;
  contentJson?: unknown;
  contentText?: unknown;
  content?: unknown;
};

const CONTAINER_TYPES = new Set(['doc', 'paragraph', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'codeBlock']);
const VOID_TYPES = new Set(['hardBreak', 'horizontalRule']);
const MARK_TYPES = new Set(['bold', 'italic', 'strike', 'code', 'highlight']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function sanitizeMarks(value: unknown): SanitizedNode['marks'] {
  if (!Array.isArray(value)) return undefined;
  const marks = value.flatMap((mark) => {
    if (!isRecord(mark) || typeof mark.type !== 'string') return [];
    if (MARK_TYPES.has(mark.type)) return [{ type: mark.type }];
    if (mark.type === 'link') {
      const href = safeHref(isRecord(mark.attrs) ? mark.attrs.href : undefined);
      return href ? [{ type: 'link', attrs: { href } }] : [];
    }
    return [];
  });
  return marks.length > 0 ? marks : undefined;
}

function sanitizeNode(value: unknown): SanitizedNode | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.type === 'text') {
    if (typeof value.text !== 'string' || value.text.length === 0) return null;
    const node: SanitizedNode = { type: 'text', text: value.text.slice(0, 20_000) };
    const marks = sanitizeMarks(value.marks);
    if (marks) node.marks = marks;
    return node;
  }
  if (VOID_TYPES.has(value.type)) return { type: value.type };
  if (value.type === 'heading') {
    const level = isRecord(value.attrs) && Number.isInteger(value.attrs.level) ? Number(value.attrs.level) : 1;
    const content = Array.isArray(value.content) ? value.content.map(sanitizeNode).filter((node): node is SanitizedNode => node !== null) : [];
    return content.length ? { type: 'heading', attrs: { level: Math.min(3, Math.max(1, level)) }, content } : null;
  }
  if (!CONTAINER_TYPES.has(value.type)) return null;
  const content = Array.isArray(value.content) ? value.content.map(sanitizeNode).filter((node): node is SanitizedNode => node !== null) : [];
  if (value.type !== 'doc' && content.length === 0) return null;
  const node: SanitizedNode = { type: value.type, content };
  if (value.type === 'orderedList' && isRecord(value.attrs) && Number.isInteger(value.attrs.start)) {
    node.attrs = { start: Math.max(1, Number(value.attrs.start)) };
  }
  if (value.type === 'taskItem' && isRecord(value.attrs) && typeof value.attrs.checked === 'boolean') {
    node.attrs = { checked: value.attrs.checked };
  }
  return node;
}

function fromPlainText(value: unknown): SanitizedRichText {
  const text = typeof value === 'string' ? value.trim() : '';
  return {
    type: 'doc',
    content: text.split(/\r?\n/).filter(Boolean).map((line) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: line.slice(0, 20_000) }],
    })),
  };
}

export function sanitizeNoteSnapshot(note: NoteLike): SanitizedRichText {
  const document = sanitizeNode(note.contentJson);
  if (document?.type === 'doc') return { type: 'doc', content: document.content || [] };
  return fromPlainText(note.contentText ?? note.content);
}
