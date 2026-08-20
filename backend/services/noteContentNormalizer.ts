export type JsonDocument = Record<string, unknown>;

export type NoteBodyErrorCode = 'NOTE_BODY_EMPTY' | 'NOTE_BODY_INVALID';

export class NoteBodyValidationError extends Error {
  constructor(public readonly code: NoteBodyErrorCode, message: string) {
    super(message);
    this.name = 'NoteBodyValidationError';
  }
}

const BLOCK_NODE_TYPES = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidDocument(): never {
  throw new NoteBodyValidationError('NOTE_BODY_INVALID', '富文本正文格式无效');
}

export function normalizePlainText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function appendLineBreak(output: string[]): void {
  if (output.length === 0 || output[output.length - 1].endsWith('\n')) return;
  output.push('\n');
}

function walkRichTextNode(node: unknown, output: string[]): void {
  if (!isRecord(node) || typeof node.type !== 'string') invalidDocument();

  const nodeType = node.type;
  if (nodeType === 'text') {
    if (typeof node.text !== 'string') invalidDocument();
    output.push(node.text);
    return;
  }

  if (nodeType === 'hardBreak') {
    appendLineBreak(output);
    return;
  }

  if (nodeType === 'image') {
    appendLineBreak(output);
    output.push('[图片]');
    appendLineBreak(output);
    return;
  }

  if (node.content !== undefined && !Array.isArray(node.content)) invalidDocument();
  const children = node.content as unknown[] | undefined;
  if (children) {
    for (const child of children) walkRichTextNode(child, output);
  }

  if (BLOCK_NODE_TYPES.has(nodeType)) appendLineBreak(output);
}

export function extractPlainTextFromRichText(document: JsonDocument): string {
  if (document.type !== 'doc' || !Array.isArray(document.content)) invalidDocument();

  const output: string[] = [];
  for (const node of document.content) walkRichTextNode(node, output);
  const contentText = normalizePlainText(output.join(''));

  if (!contentText) {
    throw new NoteBodyValidationError('NOTE_BODY_EMPTY', '笔记正文不能为空');
  }

  return contentText;
}
