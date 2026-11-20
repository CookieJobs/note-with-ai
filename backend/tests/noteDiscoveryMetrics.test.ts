import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeDiscoveryMetrics } from '../services/noteDiscoveryMetrics';
test('metrics preserve unknown cost and empty denominators, dedupe within each account', () => {
  const empty = summarizeDiscoveryMetrics({ runs: [], discoveries: [], feedback: [] });
  assert.equal(empty.successRate, null);
  assert.equal(empty.savedRate, null);
  const result = summarizeDiscoveryMetrics({
    runs: [{ status: 'completed', usage: { costCnyMicros: 100 } }, { status: 'no_result', usage: { costCnyMicros: null } }],
    discoveries: [{ userId: 'a', observationFingerprint: 'same', exposedAt: new Date(), sessionId: 's' },
      { userId: 'b', observationFingerprint: 'same' }],
    feedback: [{ discoveryId: 'd', kind: 'not_related' }, { discoveryId: 'd', kind: 'not_interested' },
      { discoveryId: 'e', kind: 'not_related', revokedAt: new Date() }],
  });
  assert.equal(result.successRate, .5);
  assert.equal(result.unknownCostRuns, 1);
  assert.equal(result.meanKnownCostCnyMicros, 100);
  assert.equal(result.repeatedObservationRate, 0);
  assert.equal(result.continuedRate, 1);
  assert.equal(result.activeNegativeDiscoveries, 1);
  assert.equal(result.positiveEndorsementRate, null);
});
