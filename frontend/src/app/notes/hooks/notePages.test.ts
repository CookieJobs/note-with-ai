import type { InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { Note } from './useNotes';
import {
  flattenNotePages,
  mapNotesInPages,
  prependNoteToPages,
  removeNoteFromPages,
  selectCanonicalSnapshot,
  type NotePage,
} from './notePages';

const first: Note = {
  _id: 'first', title: 'first', content: 'first', contentText: 'first', contentJson: null,
  summary: '', concepts: [], keywords: [], recommendCache: null, revision: 4,
  enrichment: { sourceRevision: 4, status: 'pending' },
  createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z',
};
const second: Note = { ...first, _id: 'second', title: 'second' };
const third: Note = { ...first, _id: 'third', title: 'third' };

function pages(): InfiniteData<NotePage> {
  return {
    pages: [
      { notes: [first, second], pageInfo: { hasNextPage: true, nextCursor: 'cursor-2' } },
      { notes: [second, third], pageInfo: { hasNextPage: false, nextCursor: null } },
    ],
    pageParams: [undefined, 'cursor-2'],
  };
}

describe('note page cache helpers', () => {
  it('flattens loaded pages in stable order and drops duplicate IDs', () => {
    expect(flattenNotePages(pages()).map((note) => note._id)).toEqual(['first', 'second', 'third']);
  });

  it('prepends an optimistic note once without losing page transport metadata', () => {
    const source = pages();
    const optimistic = { ...first, _id: 'temp-1', revision: 0 };

    const result = prependNoteToPages(source, optimistic);

    expect(result.pages[0].notes.map((note) => note._id)).toEqual(['temp-1', 'first', 'second']);
    expect(result.pages.map((page) => page.pageInfo)).toEqual(source.pages.map((page) => page.pageInfo));
    expect(result.pageParams).toEqual([undefined, 'cursor-2']);
    expect(result.pages[1]).toBe(source.pages[1]);
  });

  it('replaces canonical snapshots only when revision or enrichment progress wins', () => {
    const ready = { ...first, title: 'ready', enrichment: { sourceRevision: 4, status: 'ready' as const } };
    const older = { ...first, title: 'older', revision: 3, enrichment: { sourceRevision: 3, status: 'ready' as const } };
    const newer = { ...first, title: 'newer', revision: 5, enrichment: { sourceRevision: 5, status: 'pending' as const } };

    expect(selectCanonicalSnapshot(ready, first)).toBe(ready);
    expect(selectCanonicalSnapshot(first, older)).toBe(first);
    expect(selectCanonicalSnapshot(ready, newer)).toBe(newer);

    const source = pages();
    const result = mapNotesInPages(source, (note) => (
      note._id === first._id ? selectCanonicalSnapshot(note, ready) : note
    ));
    expect(result.pages[0].notes[0]).toBe(ready);
    expect(result.pages[1]).toBe(source.pages[1]);
  });

  it('removes an ID from every loaded page while retaining cursors and untouched pages', () => {
    const source = pages();
    const result = removeNoteFromPages(source, second._id);

    expect(flattenNotePages(result).map((note) => note._id)).toEqual(['first', 'third']);
    expect(result.pages.map((page) => page.pageInfo)).toEqual(source.pages.map((page) => page.pageInfo));
    expect(result.pageParams).toEqual(source.pageParams);
  });

  it('keeps page and data identities when a map does not change any note', () => {
    const source = pages();
    expect(mapNotesInPages(source, (note) => note)).toBe(source);
  });
});
