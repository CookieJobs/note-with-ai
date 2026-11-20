/** Opt-in, one synthetic case per invocation. Never load the application .env before safety checks. */
import assert from 'node:assert/strict';
import { evaluationPreflight, EVALUATION_URI, EvaluationSafetyError, assertEvaluationBinding, assertEvaluationBatchSafe, evaluationSettlementSummary, type EvaluationLedger } from './noteContinuationEvaluationSafety';
import { evaluationCases } from '../tests/fixtures/noteContinuation/cases';

async function main() {
  const id = process.argv[2];
  const item = evaluationCases.find(value => value.id === id);
  assert.ok(item, 'Provide one exact fixed case ID');
  const { maxMicros, metadata } = evaluationPreflight(process.env);
  assert.ok(!item.attack, 'Use contract suite for lifecycle, ownership, budget and fault cases');
  process.env.NOTE_DISCOVERY_EVAL_PROCESS_ONLY = 'true';
  process.env.MONGODB_URI = EVALUATION_URI;
  // Unused app subsystems get synthetic local-only config; never load their real credentials.
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_LOCAL_PASSWORD_ONLY = 'false';
  process.env.JWT_SECRET = 'evaluation-unused';
  process.env.ADMIN_JWT_SECRET = 'evaluation-unused-admin-secret-00000000';
  process.env.ADMIN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  process.env.QQ_EMAIL_USER = 'evaluation@example.invalid';
  process.env.QQ_EMAIL_PASS = 'evaluation-unused';
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
  await mongoose.connect(EVALUATION_URI, { serverSelectionTimeoutMS: 5000 });
  const lock = mongoose.connection.collection('noteContinuationEvaluationLock');
  try { await lock.insertOne({ _id: 'single-evaluator' as never }); }
  catch { await mongoose.disconnect(); throw new EvaluationSafetyError('EVAL_BATCH_LOCKED'); }
  try {
    const approvals = mongoose.connection.collection('noteContinuationEvaluationApproval');
    await approvals.updateOne({ _id: 'fixed-batch' as never }, { $setOnInsert: { metadata } }, { upsert: true });
    const approval = await approvals.findOne({ _id: 'fixed-batch' as never });
    assertEvaluationBinding(approval?.metadata, metadata);
    const readLedgers = async () => await mongoose.connection.collection('notediscoverybudgets').find({}).toArray() as unknown as EvaluationLedger[];
    const ledgers = await readLedgers();
    const previousRuns = await Run.find({}, { providerDeliveryUnknown: 1, failureCategory: 1 }).lean();
    try { assertEvaluationBatchSafe(ledgers, previousRuns); }
    catch (error) {
      console.error(JSON.stringify({ code: error instanceof EvaluationSafetyError ? error.code : 'EVAL_BATCH_UNSAFE',
        settlement: evaluationSettlementSummary(ledgers) }));
      throw error;
    }
    const committed = ledgers.reduce((sum, row) => sum + Number(row.spentTotalMicros ?? 0) + Number(row.reservedTotalMicros ?? 0), 0);
    if (!(committed + Math.ceil((Number(config.NOTE_DISCOVERY_MODEL_INPUT_CNY_PER_MILLION) * config.NOTE_DISCOVERY_MAX_INPUT_TOKENS
      + Number(config.NOTE_DISCOVERY_MODEL_OUTPUT_CNY_PER_MILLION) * config.NOTE_DISCOVERY_MAX_OUTPUT_TOKENS)) + 3 <= maxMicros)) {
      throw new EvaluationSafetyError('EVAL_BATCH_CAP_EXCEEDED');
    }
    if (await Run.countDocuments({ status: { $in: ['queued', 'running'] } })) throw new EvaluationSafetyError('EVAL_OTHER_RUN_PENDING');
    const userId = new mongoose.Types.ObjectId().toHexString();
    for (const [index, text] of item.notes.entries()) await Note.create({
      userId, title: `记录 ${index + 1}`, content: text, contentText: text, revision: 1,
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
    const discoveries = result?.status === 'completed' ? await Discovery.find({ runId: run._id, generation: result.generation }, { kind: 1, quality: 1, title: 1, observation: 1, whyNow: 1,
      qualification: 1, suggestedAction: 1, draft: 1, evidence: 1 }).lean() : [];
    console.log(JSON.stringify({ caseId: item.id, rubric: item.rubric, status: result?.status,
      failureCategory: result?.failureCategory, generation: result?.generation,
      providerDeliveryUnknown: result?.providerDeliveryUnknown ?? false,
      settlement: evaluationSettlementSummary(await readLedgers()), usage: result?.usage, discoveries }, null, 2));
    assertEvaluationBatchSafe(await readLedgers(), result ? [result] : []);
  } finally {
    try { await lock.deleteOne({ _id: 'single-evaluator' as never }); }
    finally { await mongoose.disconnect(); }
  }
}
if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ code: error instanceof EvaluationSafetyError ? error.code : 'EVAL_STOPPED' }));
  process.exitCode = 1;
});
