/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
// backend/utils/apiClient.ts
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { randomUUID } from 'crypto';
import { ErrorHandler } from './errorHandler';
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

  constructor(apiKey: string) {
    super({
      baseURL: 'https://api.deepseek.com/v1',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000, // DeepSeek可能需要更长时间
      retries: 2
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

    const recorder = aiUsageService.createStreamingRecorder(
      telemetry ?? { requestId: randomUUID(), operation: 'chat' },
      { provider: 'deepseek', model: String(payload.model) },
    );
    let finished = false;
    let lastUsage: ProviderUsage | undefined;

    try {
      // 使用原生 fetch 获取真正的流式响应（Node 18+ 原生支持）
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw ErrorHandler.createExternalApiError(`API请求错误 (${response.status})`, 'DeepSeek');

      if (!response.body) throw ErrorHandler.createExternalApiError('未收到流式响应 body', 'DeepSeek');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { finished = true; break; }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 最后一行可能不完整，存入 buffer

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

            const data = trimmedLine.slice(6).trim();
            if (data === '[DONE]') { finished = true; return; }

            try {
              const json = JSON.parse(data);
              lastUsage = usageFromResponse(json as DeepSeekResponse);
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch {
              // Ignore malformed SSE data; it is not persisted or logged.
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      await recorder.failed(error);
      throw error;
    } finally {
      if (finished) await recorder.succeeded(lastUsage);
      else await recorder.aborted();
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
