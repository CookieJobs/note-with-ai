import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validate } from '../middleware/validate';
import { createNoteSchema } from '../schemas/noteSchemas';
import { AppError } from '../utils/errorHandler';

describe('Note write validation contract', () => {
  it('uses the stable NOTE_BODY_INVALID code when an HTTP rich-text body is structurally invalid', async () => {
    let received: unknown;
    const middleware = validate(createNoteSchema);

    await middleware(
      { body: { body: { kind: 'rich-text', document: 'not-a-document' } }, query: {}, params: {} } as never,
      {} as never,
      (error?: unknown) => { received = error; },
    );

    assert.ok(received instanceof AppError);
    assert.equal(received.details?.code, 'NOTE_BODY_INVALID');
  });
});
