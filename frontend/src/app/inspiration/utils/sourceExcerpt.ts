/** Produce a small plain-text preview; the original snippet remains available. */
export function getSourceExcerptPreview(snippet: string): {
  text: string;
  expandable: boolean;
} {
  const original = snippet.trim();
  const cleaned = original
    .replace(/```[^\S\r\n]*[a-z0-9_-]*\r?\n/giu, '')
    .replace(/```/gu, '')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/(^|\s)#{1,6}\s+/gu, '$1')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/(^|[\s(（])\*([^*\r\n]+)\*(?=$|[\s.,!?，。！？)）])/gu, '$1$2')
    .replace(/(^|[\s(（])_([^_\r\n]+)_(?=$|[\s.,!?，。！？)）])/gu, '$1$2')
    .replace(/\s+/gu, ' ')
    .trim();
  const points = Array.from(cleaned);
  return {
    text: points.length > 220 ? `${points.slice(0, 220).join('')}…` : cleaned,
    expandable: !!original && (points.length > 220 || cleaned !== original),
  };
}
