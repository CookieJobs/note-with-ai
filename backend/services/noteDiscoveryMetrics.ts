/** Pure aggregation: callers must project metadata only and restrict the cohort to published runs. */
export interface DiscoveryMetricInput {
  runs: Array<{ status: string; startedAt?: Date; finishedAt?: Date; usage?: { costCnyMicros?: number | null } }>;
  discoveries: Array<{ userId: string; observationFingerprint: string; exposedAt?: Date; sessionId?: unknown; savedNoteId?: unknown }>;
  feedback: Array<{ discoveryId: string; kind: string; revokedAt?: Date; expiresAt?: Date }>;
}
export function summarizeDiscoveryMetrics(input: DiscoveryMetricInput, now = new Date()) {
  const terminal = input.runs.filter(run => ['completed', 'no_result', 'failed', 'cancelled'].includes(run.status));
  const exposed = input.discoveries.filter(row => row.exposedAt);
  const ratio = (count: number, total: number) => total ? count / total : null;
  const durations = terminal.flatMap(run => run.startedAt && run.finishedAt
    ? [Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime())] : []).sort((a, b) => a - b);
  const knownCosts = terminal.flatMap(run => typeof run.usage?.costCnyMicros === 'number' ? [run.usage.costCnyMicros] : []);
  const active = input.feedback.filter(row => !row.revokedAt && (!row.expiresAt || row.expiresAt > now));
  return {
    terminalRuns: terminal.length,
    successRate: ratio(terminal.filter(run => run.status === 'completed').length, terminal.length),
    noResultRate: ratio(terminal.filter(run => run.status === 'no_result').length, terminal.length),
    p95LatencyMs: durations.length ? durations[Math.ceil(durations.length * .95) - 1] : null,
    meanKnownCostCnyMicros: knownCosts.length ? knownCosts.reduce((a, b) => a + b, 0) / knownCosts.length : null,
    unknownCostRuns: terminal.length - knownCosts.length,
    repeatedObservationRate: ratio(input.discoveries.length - new Set(input.discoveries.map(row =>
      `${row.userId}:${row.observationFingerprint}`)).size, input.discoveries.length),
    exposed: exposed.length,
    continuedRate: ratio(exposed.filter(row => row.sessionId).length, exposed.length),
    savedRate: ratio(exposed.filter(row => row.savedNoteId).length, exposed.length),
    // Existing feedback enum has no positive endorsement. Do not infer one from absence of rejection.
    positiveEndorsementRate: null,
    activeNegativeDiscoveries: new Set(active.map(row => row.discoveryId)).size,
    negativeFeedbackRate: ratio(new Set(active.map(row => row.discoveryId)).size, exposed.length),
  };
}
