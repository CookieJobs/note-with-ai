import type { InfiniteData } from '@tanstack/react-query';
import type { INote } from '../../../types';

export type Note = INote;

export type NotePage = {
  notes: Note[];
  pageInfo: {
    hasNextPage: boolean;
    nextCursor: string | null;
  };
};

export type NotePages = InfiniteData<NotePage>;

function enrichmentProgress(note: Note): number {
  switch (note.enrichment?.status) {
    case 'ready': return 2;
    case 'degraded': return 1;
    default: return 0;
  }
}

export function selectCanonicalSnapshot(cached: Note | undefined, incoming: Note): Note {
  if (!cached || cached._id !== incoming._id) return incoming;
  if (cached.revision > incoming.revision) return cached;
  if (cached.revision < incoming.revision) return incoming;

  if (!cached.enrichment && incoming.enrichment) return incoming;
  return enrichmentProgress(incoming) > enrichmentProgress(cached) ? incoming : cached;
}

export function emptyNotePages(): NotePages {
  return {
    pages: [{ notes: [], pageInfo: { hasNextPage: false, nextCursor: null } }],
    pageParams: [undefined],
  };
}

export function flattenNotePages(data?: NotePages): Note[] {
  const seenIds = new Set<string>();
  const notes: Note[] = [];
  for (const page of data?.pages ?? []) {
    for (const note of page.notes) {
      if (seenIds.has(note._id)) continue;
      seenIds.add(note._id);
      notes.push(note);
    }
  }
  return notes;
}

export function mapNotesInPages(data: NotePages, updater: (note: Note) => Note): NotePages {
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const notes = page.notes.map((note) => {
      const next = updater(note);
      if (next !== note) pageChanged = true;
      return next;
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, notes };
  });
  return changed ? { ...data, pages } : data;
}

export function prependNoteToPages(data: NotePages, note: Note): NotePages {
  const withoutExisting = removeNoteFromPages(data, note._id);
  const firstPage = withoutExisting.pages[0];
  if (!firstPage) {
    return {
      pages: [{ notes: [note], pageInfo: { hasNextPage: false, nextCursor: null } }],
      pageParams: [undefined],
    };
  }
  return {
    ...withoutExisting,
    pages: [{ ...firstPage, notes: [note, ...firstPage.notes] }, ...withoutExisting.pages.slice(1)],
  };
}

export function removeNoteFromPages(data: NotePages, noteId: string): NotePages {
  let changed = false;
  const pages = data.pages.map((page) => {
    const notes = page.notes.filter((note) => note._id !== noteId);
    if (notes.length === page.notes.length) return page;
    changed = true;
    return { ...page, notes };
  });
  return changed ? { ...data, pages } : data;
}
