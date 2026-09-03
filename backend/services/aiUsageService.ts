import { randomUUID } from 'crypto';
import { config } from '../config';
import AiUsageEvent, { AI_USAGE_OPERATIONS, AI_USAGE_PROVIDERS } from '../models/AiUsageEvent';
import { logger } from '../utils/logger';

export type AiTelemetryContext = {
  requestId: string;
  userId?: string;
  operation: typeof AI_USAGE_OPERATIONS[number];
};

export type ProviderUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type AiProviderInfo = {
  provider: typeof AI_USAGE_PROVIDERS[number];
  model: string;
  inputPriceCnyPerMillion?: number;
  outputPriceCnyPerMillion?: number;
};

export type AiCallResult<T> = { value: T; usage?: Partial<ProviderUsage> };
type TerminalStatus = 'succeeded' | 'failed' | 'aborted';

function normalizedUsage(usage?: Partial<ProviderUsage>): ProviderUsage {
  const token = (value: unknown): number | null => (
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
  );
  return {
    inputTokens: token(usage?.inputTokens),
    outputTokens: token(usage?.outputTokens),
    totalTokens: token(usage?.totalTokens),
  };
}

function normalizedErrorCode(error: unknown): string {
  const candidate = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof candidate === 'string' && /^[A-Z0-9_]{2,100}$/.test(candidate)
    ? candidate
    : 'AI_PROVIDER_FAILED';
}

function configuredPrices(provider: AiProviderInfo['provider']): Pick<AiProviderInfo, 'inputPriceCnyPerMillion' | 'outputPriceCnyPerMillion'> {
  if (provider === 'deepseek') {
    return {
      inputPriceCnyPerMillion: config.DEEPSEEK_CHAT_INPUT_CNY_PER_MILLION,
      outputPriceCnyPerMillion: config.DEEPSEEK_CHAT_OUTPUT_CNY_PER_MILLION,
    };
  }
  const price = provider === 'openrouter'
    ? config.OPENROUTER_EMBEDDING_CNY_PER_MILLION
    : config.DASHSCOPE_EMBEDDING_CNY_PER_MILLION;
  return { inputPriceCnyPerMillion: price };
}

function requiresOutputTokens(operation: AiTelemetryContext['operation']): boolean {
  return operation !== 'embedding';
}

function estimatedCostMicros(
  usage: ProviderUsage,
  provider: AiProviderInfo,
  operation: AiTelemetryContext['operation'],
): number | null {
  const prices = { ...configuredPrices(provider.provider), ...provider };
  if (usage.inputTokens === null || (requiresOutputTokens(operation) && usage.outputTokens === null)) {
    return null;
  }
  let result = 0;
  if (usage.inputTokens !== null) {
    if (typeof prices.inputPriceCnyPerMillion !== 'number') return null;
    result += usage.inputTokens * prices.inputPriceCnyPerMillion;
  }
  if (usage.outputTokens !== null) {
    if (typeof prices.outputPriceCnyPerMillion !== 'number') return null;
    result += usage.outputTokens * prices.outputPriceCnyPerMillion;
  }
  return Math.round(result);
}

export class AiUsageService {
  constructor(private readonly persistenceReady: () => boolean = () => AiUsageEvent.db.readyState === 1) {}

  async run<T>(context: AiTelemetryContext, provider: AiProviderInfo, call: () => Promise<AiCallResult<T>>): Promise<T> {
    const recorder = this.createStreamingRecorder(context, provider);
    try {
      const result = await call();
      await recorder.succeeded(result.usage);
      return result.value;
    } catch (error) {
      await recorder.failed(error);
      throw error;
    }
  }

  createStreamingRecorder(context: AiTelemetryContext, provider: AiProviderInfo): AiUsageRecorder {
    return new AiUsageRecorder(context, provider, this.persistenceReady);
  }

  static newContext(operation: AiTelemetryContext['operation'], userId?: string): AiTelemetryContext {
    return { requestId: randomUUID(), userId, operation };
  }
}

export class AiUsageRecorder {
  private readonly startedAt = new Date();
  private terminal = false;

  constructor(
    private readonly context: AiTelemetryContext,
    private readonly provider: AiProviderInfo,
    private readonly persistenceReady: () => boolean,
  ) {}

  succeeded(usage?: Partial<ProviderUsage>): Promise<void> {
    return this.finish('succeeded', usage);
  }

  failed(error: unknown): Promise<void> {
    return this.finish('failed', undefined, normalizedErrorCode(error));
  }

  aborted(): Promise<void> {
    return this.finish('aborted');
  }

  private async finish(status: TerminalStatus, usage?: Partial<ProviderUsage>, errorCode?: string): Promise<void> {
    if (this.terminal) return;
    this.terminal = true;
    const finishedAt = new Date();
    const tokens = normalizedUsage(usage);
    const event = {
      requestId: this.context.requestId,
      ...(this.context.userId ? { userId: this.context.userId } : {}),
      provider: this.provider.provider,
      model: this.provider.model,
      operation: this.context.operation,
      status,
      startedAt: this.startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - this.startedAt.getTime()),
      ...tokens,
      estimatedCostMicros: status === 'succeeded'
        ? estimatedCostMicros(tokens, this.provider, this.context.operation)
        : null,
      currency: 'CNY' as const,
      ...(errorCode ? { errorCode } : {}),
    };
    if (!this.persistenceReady()) {
      logger.warn('AI usage telemetry unavailable', {
        requestId: this.context.requestId,
        errorCode: 'AI_USAGE_PERSISTENCE_UNAVAILABLE',
      });
      return;
    }
    try {
      await AiUsageEvent.create(event);
    } catch (error: unknown) {
      // Provider results must retain their existing contract even if metering storage is unavailable.
      const mongoCode = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'number'
        ? (error as { code: number }).code
        : undefined;
      if (mongoCode === 11000) return;
      const code = mongoCode !== undefined
        ? `MONGO_${mongoCode}`
        : 'AI_USAGE_WRITE_FAILED';
      logger.warn('AI usage telemetry write failed', { requestId: this.context.requestId, errorCode: code });
    }
  }
}

export const aiUsageService = new AiUsageService();
