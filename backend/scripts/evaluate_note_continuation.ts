/** Opt-in, one synthetic case per invocation. Never load the application .env before safety checks. */
import assert from 'node:assert/strict';
import { evaluationCases } from '../tests/fixtures/noteContinuation/cases';

async function main() {
  const id = process.argv[2];
  const item = evaluationCases.find(value => value.id === id);
  assert.ok(item, 'Provide one exact fixed case ID');
  assert.equal(process.env.NOTE_DISCOVERY_EVAL_ALLOW_PAID, 'yes', 'Live evaluation requires explicit paid-call authorization');
  // Adversarial storage/fault scenarios belong to the contract suite, not a paid prompt simulation.
  assert.ok(!item.attack, 'Use contract suite for lifecycle, ownership, budget and fault cases');
  const uri = new URL(process.env.NOTE_DISCOVERY_TEST_MONGO_URI ?? '');
  assert.equal(uri.protocol, 'mongodb:');
  assert.equal(uri.host, '127.0.0.1:27028');
  assert.equal(uri.username + uri.password + uri.search + uri.hash, '');
  assert.match(uri.pathname, /^\/nwai_discovery_test_[a-z0-9_]+$/);
  const maxMicros = Number(process.env.NOTE_DISCOVERY_EVAL_MAX_CNY_MICROS);
  assert.ok(Number.isSafeInteger(maxMicros) && maxMicros > 0 && maxMicros <= 2_100_000,
    'Set an explicitly approved batch cap, at most 2.1 CNY; this is a ceiling, not a price');
  // Stable batch database retains budget between invocations. Never drop it automatically.
  process.env.MONGODB_URI = uri.href;
  const [{ config }, mongooseModule, { Note }, { NoteDiscoveryWorkerStore }, { NoteDiscoveryScheduleService },
    { NoteDiscoveryBudgetService }, { NoteDiscoveryWorker }, { noteDiscoveryProvider }, { default: Discovery },
    { default: Run }] = await Promise.all([
    import('../config'), import('mongoose'), import('../models/Note'), import('../services/noteDiscoveryWorkerStore'),
    import('../services/noteDiscoveryScheduleService'), import('../services/noteDiscoveryBudgetService'),
    import('../services/noteDiscoveryWorker'), import('../services/noteDiscoveryProvider'), import('../models/NoteDiscovery'),
    import('../models/NoteDiscoveryRun'),
  ]);
  assert.ok(config.NOTE_DISCOVERY_RUNNABLE && noteDiscoveryProvider, 'Verified model/prices, embedding prices, caps and key are required');
  for (const cap of [config.NOTE_DISCOVERY_USER_DAILY_CNY_MICROS, config.NOTE_DISCOVERY_GLOBAL_DAILY_CNY_MICROS,
    config.NOTE_DISCOVERY_RUN_RESERVATION_CNY_MICROS]) assert.ok(cap! > 0 && cap! <= maxMicros);
  const mongoose = mongooseModule.default;
  await mongoose.connect(uri.href, { serverSelectionTimeoutMS: 5000 });
  const lock = mongoose.connection.collection('noteContinuationEvaluationLock');
  try { await lock.insertOne({ _id: 'single-evaluator' as never }); }
  catch { await mongoose.disconnect(); throw new Error('evaluation_locked'); }
  try {
    // Lifetime ledger bound remains across dates and unique synthetic users. Reservations count conservatively.
    const ledgers = await mongoose.connection.collection('notediscoverybudgets').find({}).toArray();
    const committed = ledgers.reduce((sum, row) => sum + Number(row.spentTotalMicros ?? 0) + Number(row.reservedTotalMicros ?? 0), 0);
    assert.ok(committed + Math.ceil((Number(config.NOTE_DISCOVERY_MODEL_INPUT_CNY_PER_MILLION) * config.NOTE_DISCOVERY_MAX_INPUT_TOKENS
      + Number(config.NOTE_DISCOVERY_MODEL_OUTPUT_CNY_PER_MILLION) * config.NOTE_DISCOVERY_MAX_OUTPUT_TOKENS)) + 3 <= maxMicros,
      'Retained batch budget cannot cover the worst-case cumulative run usage plus rounding guard');
    assert.equal(await Run.countDocuments({ status: { $in: ['queued', 'running'] } }), 0, 'Do not run alongside another worker');
    const userId = new mongoose.Types.ObjectId().toHexString();
    for (const [index, text] of item.notes.entries()) await Note.create({
      userId, title: `${item.id}-${index + 1}`, content: text, contentText: text, revision: 1,
      createdAt: new Date(Date.UTC(2026, 0, index + 1)),
    });
    const budget = new NoteDiscoveryBudgetService({ enabled: true,
      userCapMicros: config.NOTE_DISCOVERY_USER_DAILY_CNY_MICROS,
      globalCapMicros: config.NOTE_DISCOVERY_GLOBAL_DAILY_CNY_MICROS,
      attemptCapMicros: config.NOTE_DISCOVERY_RUN_RESERVATION_CNY_MICROS,
    });
    const store = new NoteDiscoveryWorkerStore({ budget });
    const schedule = new NoteDiscoveryScheduleService({ enabled: true, store });
    // Isolate one manual run: evaluating must not schedule older synthetic accounts.
    // Authorization, lease, tools, provider, publication and reconciliation remain real.
    schedule.initializeOnStartup = async () => 0;
    schedule.scanDue = async () => 0;
    const run = await store.enqueue(userId, { changedAt: new Date() }, `eval-${item.id}`, { trigger: 'manual' });
    assert.ok(run);
    await new NoteDiscoveryWorker({ store, schedule, budget, enabled: () => true }).tick();
    const result = await Run.findById(run._id).lean();
    // Output is deliberately synthetic; production observability never prints discovery prose.
    const discoveries = await Discovery.find({ runId: run._id }, { title: 1, observation: 1, whyNow: 1,
      qualification: 1, suggestedAction: 1, draft: 1, evidence: 1 }).lean();
    console.log(JSON.stringify({ caseId: item.id, rubric: item.rubric, status: result?.status,
      usage: result?.usage, discoveries }, null, 2));
  } finally {
    await lock.deleteOne({ _id: 'single-evaluator' as never });
    await mongoose.disconnect();
  }
}
if (require.main === module) main().catch(() => {
  console.error('Evaluation stopped: prerequisite, cap, database or execution check failed. Review configuration without printing secrets.');
  process.exitCode = 1;
});
