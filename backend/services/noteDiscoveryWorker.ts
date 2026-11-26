import { isNoteDiscoveryRunnable } from './noteDiscoveryEnvironment';
import { recoverDiscoveryUserCleanup } from './noteDiscoveryApiService';
import { recoverDiscoveryConversations } from './noteDiscoveryConversationService';
import type { DiscoveryRunStatus, DiscoveryRunUsage } from '../types/noteDiscovery';
import logger from '../utils/logger';
import { DiscoveryExecutionError, NoteContinuationAgent, type DiscoveryAgentOptions } from './noteContinuationAgent';
import { DiscoveryReservationRecoveryError } from './noteDiscoveryBudgetService';
import { noteDiscoveryScheduleService } from './noteDiscoveryScheduleService';
import { cleanUnpublishedDiscoveries } from './noteDiscoveryService';
import { getRuntimeDiscoveryProvider } from './noteDiscoveryProvider';
import { noteDiscoveryWorkerStore } from './noteDiscoveryWorkerStore';

interface WorkerOptions {
  store?: typeof noteDiscoveryWorkerStore;
  schedule?: typeof noteDiscoveryScheduleService;
  budget?: DiscoveryAgentOptions['budget'];
  enabled?: () => boolean;
  heartbeatMs?: number;
  agentOptions?: Omit<DiscoveryAgentOptions, 'store' | 'budget' | 'signal'>;
}

export class NoteDiscoveryWorker {
  private readonly store: typeof noteDiscoveryWorkerStore;
  private readonly schedule: typeof noteDiscoveryScheduleService;
  private readonly enabled: () => boolean | Promise<boolean>;
  private readonly heartbeatMs: number;
  private initialized = false;
  private nextCleanup = 0;

  constructor(private readonly options: WorkerOptions = {}) {
    this.store = options.store ?? noteDiscoveryWorkerStore;
    this.schedule = options.schedule ?? noteDiscoveryScheduleService;
    this.enabled = options.enabled ?? isNoteDiscoveryRunnable;
    this.heartbeatMs = options.heartbeatMs ?? 10_000;
  }

  async tick(signal = new AbortController().signal): Promise<void> {
    if (signal.aborted) return;
    await recoverDiscoveryUserCleanup();
    await recoverDiscoveryConversations();
    if (!await this.enabled()) {
      this.initialized = false;
      await this.store.cancelAllQueued();
      await this.store.recoverExpiredRuns();
      return;
    }
    if (!this.initialized) {
      await this.schedule.initializeOnStartup();
      this.initialized = true;
    }
    if (Date.now() >= this.nextCleanup) {
      this.nextCleanup = Date.now() + 60_000;
      try { await cleanUnpublishedDiscoveries(); }
      catch { logger.warn('Note discovery cleanup failed', { code: 'DISCOVERY_CLEANUP_FAILED' }); }
    }
    if (signal.aborted || !await this.enabled()) return;
    await this.schedule.scanDue();
    if (signal.aborted || !await this.enabled()) return;
    const run = await this.store.claimNext();
    if (!run) return;

    const runId = run._id.toHexString();
    const userId = run.userId.toHexString();
    const leaseLoss = new AbortController();
    const activeSignal = AbortSignal.any([leaseLoss.signal, signal]);
    let renewing = false;
    let closed = false;
    const heartbeat = setInterval(async () => {
      if (renewing || closed) return;
      renewing = true;
      try {
        if ((!await this.enabled() || !await this.store.renewLease(runId, run.leaseToken)) && !closed) leaseLoss.abort();
      } catch {
        if (!closed) leaseLoss.abort();
      } finally {
        renewing = false;
      }
    }, this.heartbeatMs);
    const finish = async (
      status: Extract<DiscoveryRunStatus, 'no_result' | 'cancelled' | 'failed'>,
      usage?: DiscoveryRunUsage, failureCategory?: DiscoveryExecutionError['category'],
    ) => this.store.finish(runId, run.leaseToken, status, { usage, failureCategory });
    const reconcile = async () => {
      try { await this.schedule.reconcile(userId); }
      catch { logger.warn('Note discovery reconciliation failed', { code: 'DISCOVERY_RECONCILE_FAILED' }); }
    };
    const deferPendingDispatch = (
      agent: NoteContinuationAgent | undefined,
      status: 'cancelled' | 'failed', failureCategory?: DiscoveryExecutionError['category'],
    ): boolean => {
      const cleanup = agent?.getPendingDispatchCleanup();
      if (!cleanup) return false;
      void cleanup.then(async (settled) => {
        if (settled && await finish(status, agent?.getUsage(), failureCategory)) await reconcile();
      }).catch(() => logger.warn('Note discovery dispatch cleanup needs lease recovery', { code: 'DISCOVERY_DISPATCH_CLEANUP_FAILED' }));
      return true;
    };

    let terminal = false;
    let agent: NoteContinuationAgent | undefined;
    try {
      const admission = await this.schedule.authorizeRun(run);
      if (admission.status === 'blocked') {
        terminal = true;
        return;
      }
      if (admission.status === 'disabled') {
        terminal = await finish('cancelled');
        return;
      }
      if (admission.status !== 'authorized') return;

      agent = new NoteContinuationAgent(run, {
        ...this.options.agentOptions,
        provider: this.options.agentOptions?.provider === undefined
          ? await getRuntimeDiscoveryProvider() : this.options.agentOptions.provider,
        store: this.store, budget: this.options.budget, signal: activeSignal,
      });
      const outcome = await agent.runDiscovery(userId, runId, async () =>
        await this.schedule.canPublish(run) && !activeSignal.aborted && await this.enabled());
      // External abort returns cancelled normally, but its pre-send storage write
      // may still need cleanup. Keep it recoverable just as on deadline failure.
      if (outcome === 'cancelled' && deferPendingDispatch(agent, 'cancelled')) return;
      if (outcome === 'completed') terminal = true;
      else terminal = await finish(outcome, agent.getUsage());
      if (outcome === 'no_result' && !terminal && !await this.schedule.canPublish(run)) {
        terminal = await finish('cancelled', agent.getUsage());
      }
    } catch (error) {
      const category = error instanceof DiscoveryExecutionError ? error.category : 'internal_error';
      if (deferPendingDispatch(agent, 'failed', category)) return;
      if (error instanceof DiscoveryReservationRecoveryError) return;
      terminal = await finish('failed', agent?.getUsage(), category);
    } finally {
      closed = true;
      clearInterval(heartbeat);
      if (terminal) await reconcile();
    }
  }
}

export const noteDiscoveryWorker = new NoteDiscoveryWorker();
