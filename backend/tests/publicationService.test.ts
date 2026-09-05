import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Note } from '../models/Note';
import PublishedNote from '../models/PublishedNote';
import User from '../models/User';
import { publicationService } from '../services/publicationService';

describe('publication snapshots', () => {
  afterEach(() => mock.restoreAll());

  it('creates a separate sanitized snapshot from an owned note', async () => {
    mock.method(Note, 'findOne', async () => ({ _id: 'note-a', revision: 3, title: '私密标题', contentText: '公开正文' }) as never);
    mock.method(User, 'findById', async () => ({ username: '作者' }) as never);
    let saved: any;
    mock.method(PublishedNote, 'create', async (input: any) => { saved = input; return { _id: 'publication-a', ...input }; });
    const result = await publicationService.create('owner-a', 'note-a');
    assert.equal(result.sourceRevision, 3);
    assert.equal(saved.ownerUserId, 'owner-a');
    assert.equal(result.contentSnapshot.content[0].content[0].text, '公开正文');
  });

  it('does not disclose owner or source note fields through the public DTO', async () => {
    mock.method(PublishedNote, 'findOne', async () => ({
      slug: 'x'.repeat(24), ownerUserId: 'owner-a', sourceNoteId: 'note-a', sourceRevision: 3,
      title: '标题', contentSnapshot: { type: 'doc', content: [] }, authorDisplayName: '作者',
      publishedAt: new Date(), updatedAt: new Date(),
    }) as never);
    const result = await publicationService.getPublic('x'.repeat(24));
    assert.equal('ownerUserId' in result, false);
    assert.equal('sourceNoteId' in result, false);
    assert.equal('sourceRevision' in result, false);
  });
});

