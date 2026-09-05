import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertInspirationRequestAllowed, resetInspirationRateLimits } from '../services/inspirationRateLimit';

describe('inspiration request rate limit', () => {
  it('limits both the user and client IP within the request window', () => {
    resetInspirationRateLimits();
    assert.doesNotThrow(() => assertInspirationRequestAllowed('user-a', '203.0.113.1', 1_000));
    assert.throws(() => assertInspirationRequestAllowed('user-a', '203.0.113.2', 1_001), /稍后再试/);
    assert.throws(() => assertInspirationRequestAllowed('user-b', '203.0.113.1', 1_001), /稍后再试/);
    assert.doesNotThrow(() => assertInspirationRequestAllowed('user-a', '203.0.113.1', 62_000));
  });
});
