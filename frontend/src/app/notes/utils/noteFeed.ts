/* Pure list display helpers; never write derived text back to a note. */
export function noteFeedText(note: { contentText?: string; content?: string }): string {
  // contentText is an authoritative plain-text projection: punctuation is user content.
  if (note.contentText?.trim()) return note.contentText.trim();
  const source = note.content ?? '';
  return source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '').replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/gm, '')
    .replace(/[*_`~]+/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

export function placeNoteCards(heights: number[], columns: number, width: number, gap: number) {
  const bottoms = Array(Math.max(1, columns)).fill(0) as number[];
  const positions = heights.map(height => {
    const column = bottoms.indexOf(Math.min(...bottoms));
    const position = { left: column * (width + gap), top: bottoms[column] };
    bottoms[column] += height + gap;
    return position;
  });
  return { positions, height: Math.max(0, ...bottoms) - (heights.length ? gap : 0) };
}

export function beijingDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function monthGrid(month: string): (string | null)[] {
  const [year, number] = month.split('-').map(Number);
  const start = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return [...Array(start).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
}

export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
