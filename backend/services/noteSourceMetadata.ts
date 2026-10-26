type SourceNote = {
  contentText?: unknown;
  content?: unknown;
  contentJson?: unknown;
  createdAt?: unknown;
};

const IMAGE_ONLY_LINE = /^(?:\[图片\]|\[image\]|!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>)$/iu;

export function sourceMetadata(note: SourceNote) {
  const body = typeof note.contentText === 'string' && note.contentText.trim()
    ? note.contentText : typeof note.content === 'string' ? note.content : '';
  const excerpt = Array.from(body).slice(0, 600).join('');
  let imageCount = 0;
  let firstImageSrc: string | undefined;
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.type === 'image') {
      imageCount += 1;
      const attrs = node.attrs as Record<string, unknown> | undefined;
      if (!firstImageSrc && typeof attrs?.src === 'string') firstImageSrc = attrs.src;
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(note.contentJson);
  if (!imageCount) {
    const markdownImages = [...body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)];
    const htmlImages = [...body.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)];
    imageCount = markdownImages.length + htmlImages.length;
    firstImageSrc = markdownImages[0]?.[1] || htmlImages[0]?.[1];
  }
  const readable = body.split(/\r?\n/u).some((line) => line.trim() && !IMAGE_ONLY_LINE.test(line.trim()));
  const sourceType = imageCount ? (readable ? 'mixed' : 'image') : 'text';
  const date = note.createdAt instanceof Date ? note.createdAt : note.createdAt ? new Date(String(note.createdAt)) : null;
  return {
    excerpt,
    sourceType,
    imageCount,
    firstImageSrc,
    createdAt: date && !Number.isNaN(date.getTime()) ? date : undefined,
  } as const;
}
