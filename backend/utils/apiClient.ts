/*
Input: 通用 HTTP 请求配置、DeepSeek 消息及可选 telemetry
Output: 带供应商用量记录的 API 响应
Pos: 后端 AI HTTP 客户端
Note: DeepSeek 默认保留两次 HTTP 总尝试；流式调用有45秒响应/空闲与120秒总时限，只接受显式终止标记
*/
// backend/utils/apiClient.ts
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { randomUUID } from 'crypto';
import { AppError, ErrorHandler, ErrorType } from './errorHandler';
import { logger } from './logger';
import { aiUsageService, type AiTelemetryContext, type ProviderUsage } from '../services/aiUsageService';

export type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

function usageFromResponse(response: DeepSeekResponse | undefined): ProviderUsage {
  const usage = response?.usage;
  return {
    inputTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    outputTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null,
    totalTokens: typeof usage?.total_tokens === 'number' ? usage.total_tokens : null,
  };
}

const STREAM_FIRST_RESPONSE_TIMEOUT_MS = 45_000;
const STREAM_IDLE_TIMEOUT_MS = 45_000;
const STREAM_TOTAL_TIMEOUT_MS = 120_000;
const STREAM_CLEANUP_TIMEOUT_MS = 500;
const SAFE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);

function streamAppError(
  code: string,
  message: string,
  httpStatus?: number,
  networkCode?: string,
): AppError & { code: string } {
  const error = new AppError(message, ErrorType.EXTERNAL_API, 502, true, {
    service: 'DeepSeek', code,
    ...(httpStatus ? { httpStatus } : {}),
    ...(networkCode ? { networkCode } : {}),
  }) as AppError & { code: string };
  error.code = code;
  return error;
}

function normalizeStreamError(error: unknown): AppError & { code: string } {
  if (error instanceof AppError && typeof (error as AppError & { code?: unknown }).code === 'string') {
    return error as AppError & { code: string };
  }
  const status = typeof error === 'object' && error !== null
    ? (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode
    : undefined;
  if (typeof status === 'number') {
    if (status === 401 || status === 403) {
      return streamAppError('AI_PROVIDER_AUTHENTICATION_FAILED', 'AI 服务认证失败，请检查服务配置', status);
    }
    if (status === 429) {
      return streamAppError('AI_PROVIDER_RATE_LIMITED', 'AI 服务当前请求过多，请稍后重试', status);
    }
    return streamAppError('AI_PROVIDER_HTTP_FAILED', 'AI 服务暂时不可用，请稍后重试', status);
  }
  const causeCode = typeof error === 'object' && error !== null
    ? (error as { code?: unknown; cause?: { code?: unknown } }).code
      ?? (error as { cause?: { code?: unknown } }).cause?.code
    : undefined;
  if (causeCode === 'AI_PROVIDER_TIMEOUT') {
    return streamAppError('AI_PROVIDER_TIMEOUT', 'AI 回复等待超时，请稍后重试');
  }
  if (typeof causeCode === 'string' && SAFE_NETWORK_CODES.has(causeCode)) {
    return streamAppError('AI_PROVIDER_NETWORK_ERROR', 'AI 服务连接异常，请稍后重试', undefined, causeCode);
  }
  return streamAppError('AI_PROVIDER_FAILED', 'AI 回复生成失败，请稍后重试');
}

function safeStreamLog(
  requestId: string,
  phase: string,
  errorCode: string,
  startedAt: number,
  httpStatus?: number,
  networkCode?: string,
): void {
  logger.warn(JSON.stringify({
    requestId, phase, errorCode,
    ...(httpStatus ? { httpStatus } : {}),
    ...(networkCode ? { networkCode } : {}),
    durationMs: Math.max(0, Date.now() - startedAt),
  }));
}

async function settleWithin(operation: () => Promise<void>, timeoutMs = STREAM_CLEANUP_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const completion = Promise.resolve().then(operation).catch(() => undefined);
  // Keep a rejection handler attached even if the timeout wins.
  await Promise.race([
    completion,
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  if (timer) clearTimeout(timer);
}

async function withStreamDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutError: AppError & { code: string },
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 通用API客户端配置
 */
export interface ApiClientConfig {
  baseURL: string;
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
}

/**
 * 通用API客户端类
 */
export class ApiClient {
  private config: ApiClientConfig;
  private defaultHeaders: Record<string, string>;

  constructor(config: ApiClientConfig) {
    this.config = {
      timeout: 30000,
      retries: 3,
      retryDelay: 1000,
      ...config
    };
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...config.headers
    };
  }

  /**
   * 执行HTTP请求，带重试机制
   */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: Record<string, unknown>,
    options?: AxiosRequestConfig
  ): Promise<T> {
    const url = `${this.config.baseURL}${endpoint}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= (this.config.retries || 1); attempt++) {
      try {
        const config: AxiosRequestConfig = {
          method,
          url,
          data,
          timeout: this.config.timeout,
          headers: {
            ...this.defaultHeaders,
            ...options?.headers
          },
          ...options
        };

        const response: AxiosResponse<T> = await axios(config);
        return response.data;
      } catch (error: unknown) {
        lastError = error;
        logger.warn('API request failed', {
          url,
          method,
          attempt,
          errorCode: 'EXTERNAL_REQUEST_FAILED',
        });

        // 如果不是最后一次尝试，等待后重试
        if (attempt < (this.config.retries || 1)) {
          await this.delay(this.config.retryDelay! * attempt);
        }
      }
    }

    // 所有重试都失败，抛出错误
    throw this.createApiError(lastError, endpoint);
  }

  /**
   * GET请求
   */
  async get<T = unknown>(endpoint: string, options?: AxiosRequestConfig): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, options);
  }

  /**
   * POST请求
   */
  async post<T = unknown>(endpoint: string, data?: Record<string, unknown>, options?: AxiosRequestConfig): Promise<T> {
    return this.request<T>('POST', endpoint, data, options);
  }

  /**
   * PUT请求
   */
  async put<T = unknown>(endpoint: string, data?: Record<string, unknown>, options?: AxiosRequestConfig): Promise<T> {
    return this.request<T>('PUT', endpoint, data, options);
  }

  /**
   * DELETE请求
   */
  async delete<T = unknown>(endpoint: string, options?: AxiosRequestConfig): Promise<T> {
    return this.request<T>('DELETE', endpoint, undefined, options);
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 创建API错误
   */
  private createApiError(error: unknown, endpoint: string): Error {
    const statusCode = (error as any).response?.status;
    
    if (statusCode >= 400 && statusCode < 500) {
      return ErrorHandler.createValidationError('API请求错误');
    } else if (statusCode >= 500) {
      return ErrorHandler.createExternalApiError('外部服务错误', endpoint);
    } else {
      return ErrorHandler.createExternalApiError('网络错误', endpoint);
    }
  }
}

/**
 * DeepSeek API客户端
 */
export class DeepSeekApiClient extends ApiClient {
  private apiKey: string;

  constructor(apiKey: string, options: { retries?: number } = {}) {
    super({
      baseURL: 'https://api.deepseek.com/v1',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000, // DeepSeek可能需要更长时间
      // retries here means total HTTP attempts. Keep the existing default for all callers.
      retries: options.retries ?? 2
    });
    this.apiKey = apiKey;
  }

  /**
   * 聊天完成请求
   */
  async chatCompletion(
    messages: { role: string; content: string }[],
    options: Record<string, unknown> = {},
    telemetry?: AiTelemetryContext,
  ): Promise<string> {
    const payload = {
      model: 'deepseek-chat',
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      stream: false,
      ...options
    };

    const call = async () => {
      const response = await this.post<DeepSeekResponse>('/chat/completions', payload);
      const reply = response.choices?.[0]?.message?.content?.trim();
      if (!reply) throw ErrorHandler.createExternalApiError('未收到模型回复', 'DeepSeek');
      return { value: reply, usage: usageFromResponse(response) };
    };
    return aiUsageService.run(
      telemetry ?? { requestId: randomUUID(), operation: 'chat' },
      { provider: 'deepseek', model: String(payload.model) },
      call,
    );
  }

  /**
   * 流式聊天完成请求
   * 使用原生 fetch 代替 axios，确保 DeepSeek SSE 数据流逐 chunk 返回，不被缓冲
   */
  async *chatCompletionStream(
    messages: { role: string; content: string }[],
    options: Record<string, unknown> = {},
    telemetry?: AiTelemetryContext,
  ): AsyncIterable<string> {
    const payload = {
      model: 'deepseek-chat',
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      stream: true,
      ...options,
      stream_options: { include_usage: true },
    };

    const context = telemetry ?? { requestId: randomUUID(), operation: 'chat' as const };
    const requestStartedAt = Date.now();
    const recorder = aiUsageService.createStreamingRecorder(
      context,
      { provider: 'deepseek', model: String(payload.model) },
    );
    let terminal = false;
    let responseReceived = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let lastUsage: ProviderUsage | undefined;
    const controller = new AbortController();

    const remainingTotalMs = () => STREAM_TOTAL_TIMEOUT_MS - (Date.now() - requestStartedAt);
    const idleTimeout = () => streamAppError('AI_PROVIDER_TIMEOUT', 'AI 回复等待超时，请稍后重试');
    const totalTimeout = () => streamAppError('AI_PROVIDER_TIMEOUT', 'AI 回复生成超时，请稍后重试');
    const processData = (data: string): { content?: string; terminal: boolean } => {
      if (!data || data === '[DONE]') return { terminal: data === '[DONE]' };
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        // Ignore malformed unrelated SSE frames; they do not establish completion.
        return { terminal: false };
      }
      if (json?.error) {
        const status = typeof json.error?.code === 'number' ? json.error.code : undefined;
        throw normalizeStreamError(status ? { status } : new Error('provider stream error'));
      }
      if (json?.usage && typeof json.usage === 'object') lastUsage = usageFromResponse(json as DeepSeekResponse);
      const choice = json?.choices?.[0];
      return {
        content: typeof choice?.delta?.content === 'string' ? choice.delta.content : undefined,
        terminal: choice?.finish_reason === 'stop' || choice?.finish_reason === 'length',
      };
    };
    const processLine = async function* (line: string): AsyncGenerator<{ content?: string; terminal: boolean }> {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) yield processData(trimmed.slice(5).trim());
    };

    try {
      const response = await withStreamDeadline(fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }), Math.min(STREAM_FIRST_RESPONSE_TIMEOUT_MS, remainingTotalMs()), idleTimeout());
      responseReceived = true;

      if (!response.ok) throw Object.assign(new Error('provider http error'), { status: response.status });
      if (!response.body) throw streamAppError('AI_PROVIDER_EMPTY_RESPONSE', 'AI 服务未返回流式内容');

      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (!terminal) {
        const remaining = remainingTotalMs();
        if (remaining <= 0) throw totalTimeout();
        const waitMs = Math.min(STREAM_IDLE_TIMEOUT_MS, remaining);
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await withStreamDeadline(reader.read(), waitMs, remaining < STREAM_IDLE_TIMEOUT_MS ? totalTimeout() : idleTimeout());
        } catch (error) {
          controller.abort();
          throw error;
        }
        if (result.done) {
          buffer += decoder.decode();
          for (const line of buffer.split('\n')) {
            for await (const frame of processLine(line)) {
              if (frame.content !== undefined) yield frame.content;
              if (frame.terminal) { terminal = true; break; }
            }
            if (terminal) break;
          }
          if (!terminal) throw streamAppError('AI_PROVIDER_INCOMPLETE_STREAM', 'AI 回复流意外结束，请重试');
          break;
        }

        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          for await (const frame of processLine(line)) {
            // Preserve content carried in the same frame as finish_reason.
            if (frame.content !== undefined) yield frame.content;
            if (frame.terminal) { terminal = true; break; }
          }
          if (terminal) break;
        }
      }
    } catch (cause) {
      const error = normalizeStreamError(cause);
      safeStreamLog(context.requestId, responseReceived ? 'read' : 'response', error.code,
        requestStartedAt, error.details?.httpStatus as number | undefined,
        error.details?.networkCode as string | undefined);
      controller.abort();
      await settleWithin(() => recorder.failed(error));
      throw error;
    } finally {
      controller.abort();
      if (reader) await settleWithin(() => reader!.cancel());
      if (reader) {
        try { reader.releaseLock(); } catch { /* A pending read may still be unwinding after a deadline. */ }
      }
      if (terminal) await settleWithin(() => recorder.succeeded(lastUsage));
      else await settleWithin(() => recorder.aborted());
    }
  }

  /**
   * 推理模式聊天完成
   */
  async reasoningCompletion(messages: { role: string; content: string }[]): Promise<string> {
    const payload = {
      model: 'deepseek-reasoner',
      messages
    };

    const response = await this.post<DeepSeekResponse>('/chat/completions', payload);
    return response.choices?.[0]?.message?.reasoning_content?.trim() || '';
  }
}
