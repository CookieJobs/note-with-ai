export type NoteReferenceInput = {
  title?: string | null;
  excerpt?: string | null;
  contentText?: string | null;
  content?: string | null;
  contentJson?: unknown;
  sourceType?: 'text' | 'image' | 'mixed';
  imageCount?: number;
  firstImageSrc?: string;
  createdAt?: string | Date | null;
  matchType?: string;
  createdAtSource?: 'note';
};

const IMAGE_LINE = /^(?:\[图片\]|\[image\]|!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>)$/iu;

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function shorten(value: string, length: number): string {
  const points = Array.from(value);
  return points.length > length ? `${points.slice(0, length).join('')}…` : value;
}

export function noteReferenceDisplay(input: NoteReferenceInput) {
  const source = input.excerpt?.trim() ? input.excerpt : input.contentText?.trim() ? input.contentText : input.content ?? '';
  const lines = source.split(/\r?\n/u).map(compact).filter((line) => line && !IMAGE_LINE.test(line));
  const date = input.matchType === 'care_source' && input.createdAtSource !== 'note'
    ? null
    : input.createdAt ? new Date(input.createdAt) : null;
  const validDate = date && !Number.isNaN(date.getTime()) ? date : null;
  const dateLabel = validDate ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(validDate) : null;
  let jsonImageCount = 0;
  let jsonImageSrc: string | undefined;
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.type === 'image') {
      jsonImageCount += 1;
      const attrs = node.attrs as Record<string, unknown> | undefined;
      if (!jsonImageSrc && typeof attrs?.src === 'string') jsonImageSrc = attrs.src;
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(input.contentJson);
  const markupImageSrc = /!\[[^\]]*\]\(([^)]+)\)/u.exec(source)?.[1] || /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/iu.exec(source)?.[1];
  const firstImageSrc = input.firstImageSrc || jsonImageSrc || markupImageSrc;
  const imageCount = input.imageCount || jsonImageCount || (markupImageSrc ? 1 : 0);
  const hasImage = input.sourceType === 'image' || input.sourceType === 'mixed' || !!firstImageSrc || imageCount > 0;
  const title = input.title?.trim() || '';
  const label = title || (lines[0] ? shorten(lines[0], 48) : hasImage ? `图片笔记${imageCount > 1 ? ` · ${imageCount} 张` : ''}` : dateLabel ? `笔记 · ${dateLabel}` : '查看原笔记');
  const secondary = lines[1] ? shorten(lines[1], 80) : title && lines[0] ? shorten(lines[0], 80) : null;
  const dateInLabel = !title && !lines[0] && !hasImage && !!dateLabel;
  return { label, dateLabel: dateInLabel ? null : dateLabel, secondary, firstImageSrc: hasImage ? firstImageSrc : undefined };
}
