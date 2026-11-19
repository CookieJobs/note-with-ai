import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { Note } from '../models/Note';
import { NoteDiscoveryWorkerStore } from '../services/noteDiscoveryWorkerStore';
import { NoteDiscoveryScheduleService } from '../services/noteDiscoveryScheduleService';
import { NoteDiscoveryBudgetService } from '../services/noteDiscoveryBudgetService';
import type { DiscoveryCandidate } from '../types/noteDiscovery';
import type { DiscoveryProviderTransport } from '../services/noteDiscoveryProvider';

export const ownerId = () => new Types.ObjectId().toHexString();
export const firstText = 'The morning test ran out of water after six minutes.';
export const secondText = 'The evening test lasted twelve minutes with the vent closed.';
export const fixturePrice = {
  key: 'synthetic-fixture-key',
  model: 'deepseek-flash',
  pricedModel: 'deepseek-flash',
  inputCnyPerMillion: 2,
  outputCnyPerMillion: 8,
};

export async function makeNote(userId: string, contentText = firstText, updatedAt = new Date()) {
  return Note.create({ userId, title: 'Vent test', content: contentText, contentText, revision: 1, createdAt: updatedAt, updatedAt });
}

export async function makeRun(userId = ownerId(), options: { now?: () => Date; leaseMs?: number } = {}) {
  const budget = new NoteDiscoveryBudgetService({
    enabled: true, userCapMicros: 1_000_000, globalCapMicros: 5_000_000, attemptCapMicros: 250_000,
  }, options.now);
  const store = new NoteDiscoveryWorkerStore({ budget, ...options });
  const schedule = new NoteDiscoveryScheduleService({ enabled: true, store, now: options.now });
  const stored = await store.enqueue(userId, { changedAt: options.now?.() ?? new Date() }, randomUUID(), { trigger: 'manual' });
  assert.ok(stored);
  return { userId, runId: stored._id.toHexString(), store, schedule, budget };
}

export function makeCandidate(noteId: string, excerpt = firstText): DiscoveryCandidate {
  return {
    kind: 'next_step',
    title: 'A controlled vent comparison',
    observation: 'The baseline duration gives the next timed trial a measurable comparison.',
    whyNow: 'The recorded six-minute baseline can anchor the next trial before the setup changes.',
    qualification: 'A single baseline measures duration under this setup only.',
    suggestedAction: 'Repeat the trial with a full marked reservoir and record vent position.',
    draft: 'Keep the reservoir and timer fixed. Change the vent position. Record duration and remaining water.',
    evidence: [{ noteId, revision: 1, excerpt }],
    rationale: {
      novelInsight: 'Use duration as the comparison metric for a controlled trial.',
      counterEvidence: 'A different starting water level could explain a longer run.',
      missingInformation: ['The initial water volume was not recorded.'],
    },
  };
}

export function providerResponse(action: unknown, usage: unknown = {
  prompt_tokens: 100, completion_tokens: 60, total_tokens: 160,
}) {
  return {
    status: 200,
    data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(action) } }], usage },
  };
}

export function scriptTransport(...responses: Awaited<ReturnType<DiscoveryProviderTransport>>[]) {
  const calls: Parameters<DiscoveryProviderTransport>[0][] = [];
  const transport: DiscoveryProviderTransport = async (request) => {
    calls.push(request);
    const next = responses[calls.length - 1];
    assert.ok(next, 'Unexpected unscripted provider request');
    return next;
  };
  return { calls, transport };
}
