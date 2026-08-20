import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { noteController } from '../controllers/noteController';
import { Note } from '../models/Note';
import { noteService } from '../services/noteService';
import { NoteWriteError, type CreateNoteInput, type UpdateNoteInput } from '../services/NoteUpdateOrchestrator';
import { UserValidator } from '../utils/userValidation';
import { globalErrorHandler } from '../utils/errorHandler';

type CapturedResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => CapturedResponse;
  json: (body: unknown) => CapturedResponse;
};

function makeResponse(): CapturedResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

const canonicalResult = {
  note: {
    _id: 'note-1', content: '正文', contentText: '正文', contentJson: null, title: '正文',
    summary: '', concepts: [], keywords: [], recommendCache: null, revision: 1,
    createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
  },
  enrichment: { sourceRevision: 1, status: 'pending' as const },
};

describe('Note HTTP contract', () => {
  afterEach(() => mock.restoreAll());

  it('wraps POST /api/notes in the single canonical data.note envelope without embedding fields', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(noteService, 'createNote', async (userId: string, input: Pick<CreateNoteInput, 'body'>) => {
      assert.equal(userId, 'user-1');
      assert.deepEqual(input, { body: { kind: 'plain-text', text: '正文' } });
      return canonicalResult as never;
    });
    const response = makeResponse();

    await noteController.createNote({ body: { body: { kind: 'plain-text', text: '正文' } } } as never, response as never, () => undefined);

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, {
      success: true,
      message: '笔记创建成功',
      data: canonicalResult,
    });
    assert.equal('embedding' in canonicalResult.note, false);
    assert.equal('embeddingMetadata' in canonicalResult.note, false);
  });

  it('wraps PATCH /api/notes/:id in the same canonical data.note envelope', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(noteService, 'updateNote', async (
      userId: string,
      noteId: string,
      input: Pick<UpdateNoteInput, 'expectedRevision' | 'changes'>,
    ) => {
      assert.equal(userId, 'user-1');
      assert.equal(noteId, 'note-1');
      assert.deepEqual(input, { expectedRevision: 1, changes: { title: '新标题' } });
      return canonicalResult as never;
    });
    const response = makeResponse();

    await noteController.updateNote(
      { params: { id: 'note-1' }, body: { expectedRevision: 1, changes: { title: '新标题' } } } as never,
      response as never,
      () => undefined,
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      success: true,
      message: '笔记更新成功',
      data: canonicalResult,
    });
  });

  it('keeps the old content/updatedAt PATCH adapter at HTTP boundary and translates it to revision input', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(Note, 'findOne', async () => ({
      revision: 4,
      updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    }) as never);
    mock.method(noteService, 'updateNote', async (
      userId: string,
      noteId: string,
      input: Pick<UpdateNoteInput, 'expectedRevision' | 'changes'>,
    ) => {
      assert.equal(userId, 'user-1');
      assert.equal(noteId, 'note-1');
      assert.deepEqual(input, {
        expectedRevision: 4,
        changes: { body: { kind: 'plain-text', text: '旧客户端正文' } },
      });
      return canonicalResult as never;
    });
    const response = makeResponse();

    await noteController.updateNote(
      {
        params: { id: 'note-1' },
        body: { contentText: '旧客户端正文', updatedAt: '2026-08-18T00:00:00.000Z' },
      } as never,
      response as never,
      () => undefined,
    );

    assert.equal(response.statusCode, 200);
  });

  it('serializes revision conflicts with the current canonical snapshot at the HTTP boundary', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({ _id: { toString: () => 'user-1' } }) as never);
    mock.method(noteService, 'updateNote', async () => {
      throw new NoteWriteError('NOTE_WRITE_CONFLICT', '笔记已被其他写入更新', 409, canonicalResult);
    });
    const response = makeResponse();
    let captured: unknown;

    try {
      await noteController.updateNote(
        { params: { id: 'note-1' }, body: { expectedRevision: 1, changes: { title: '新标题' } } } as never,
        response as never,
        () => undefined,
      );
    } catch (error) {
      captured = error;
    }
    assert.ok(captured);
    globalErrorHandler(captured as never, { method: 'PATCH', path: '/api/notes/note-1' } as never, response as never, () => undefined);

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.body, {
      success: false,
      error: '笔记已被其他写入更新',
      message: '笔记已被其他写入更新',
      type: 'VALIDATION_ERROR',
      code: 'NOTE_WRITE_CONFLICT',
      current: canonicalResult,
    });
  });
});
