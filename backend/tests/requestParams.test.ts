import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError, ErrorType } from '../utils/errorHandler';
import { requireSingleRouteParam } from '../utils/requestParams';

describe('requireSingleRouteParam', () => {
  it('returns a single string route parameter unchanged', () => {
    assert.equal(requireSingleRouteParam('note-1', 'id'), 'note-1');
  });

  it('rejects an array route parameter as a validation error', () => {
    assert.throws(
      () => requireSingleRouteParam(['note-1', 'note-2'], 'id'),
      (error: unknown) => (
        error instanceof AppError
        && error.type === ErrorType.VALIDATION
        && error.statusCode === 400
      ),
    );
  });

  it('rejects a missing route parameter as a validation error', () => {
    assert.throws(
      () => requireSingleRouteParam(undefined, 'id'),
      (error: unknown) => error instanceof AppError && error.type === ErrorType.VALIDATION,
    );
  });
});
