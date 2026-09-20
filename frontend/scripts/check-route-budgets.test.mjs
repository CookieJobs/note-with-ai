import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRouteBudgets } from './check-route-budgets.mjs';

test('accepts a route within its byte budget', () => {
  assert.deepEqual(
    checkRouteBudgets({ pages: { '/notes': ['a.js', 'b.js'] } }, { routes: { '/notes': { maxBytes: 10 } } }, (asset) => asset === 'a.js' ? 4 : 6),
    [],
  );
});

test('reports missing routes and budget regressions', () => {
  assert.deepEqual(
    checkRouteBudgets({ pages: { '/notes': ['notes.js'] } }, { routes: { '/notes': { maxBytes: 9 }, '/missing': { maxBytes: 1 } } }, () => 10),
    ['/notes: 10 bytes exceeds 9 bytes', '/missing: route assets were not found in build manifest'],
  );
});

test('finds an App Router route under its page manifest key', () => {
  assert.deepEqual(
    checkRouteBudgets({ pages: { '/notes/page': ['notes.js'] } }, { routes: { '/notes': { maxBytes: 10 } } }, () => 10),
    [],
  );
});
