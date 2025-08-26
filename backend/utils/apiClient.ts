// backend/utils/apiClient.ts
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { ErrorHandler } from './errorHandler';

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
  async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any,
    options?: AxiosRequestConfig
  ): Promise<T> {
    const url = `${this.config.baseURL}${endpoint}`;
    let lastError: any;

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
      } catch (error: any) {
        lastError = error;
        console.warn(`❌ API请求失败 (尝试 ${attempt}/${this.config.retries}):`, {
          url,
          method,
          error: error.message
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
  async get<T = any>(endpoint: string, options?: AxiosRequestConfig): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, options);
  }

  /**
   * POST请求
   */
  async post<T = any>(endpoint: string, data?: any, options?: AxiosRequestConfig): Promise<T> {
    return this.request<T>('POST', endpoint, data, options);
  }

  /**
   * PUT请求
   */
  async put<T = any>(endpoint: string, data?: any, options?: AxiosRequestConfig): Promise<T> {
    return this.request<T>('PUT', endpoint, data, options);
  }

  /**
   * DELETE请求
   */
  async delete<T = any>(endpoint: string, options?: AxiosRequestConfig): Promise<T> {
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
  private createApiError(error: any, endpoint: string): Error {
    const message = error.response?.data?.message || error.message || '未知错误';
    const statusCode = error.response?.status;
    
    if (statusCode >= 400 && statusCode < 500) {
      return ErrorHandler.createValidationError(`API请求错误: ${message}`);
    } else if (statusCode >= 500) {
      return ErrorHandler.createExternalApiError(`外部服务错误: ${message}`, endpoint);
    } else {
      return ErrorHandler.createExternalApiError(`网络错误: ${message}`, endpoint);
    }
  }
}

/**
 * DeepSeek API客户端
 */
export class DeepSeekApiClient extends ApiClient {
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
  }

  /**
   * 聊天完成请求
   */
  async chatCompletion(messages: any[], options: any = {}): Promise<any> {
    const payload = {
      model: 'deepseek-chat',
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      stream: false,
      ...options
    };

    const response = await this.post('/chat/completions', payload);
    
    const reply = response.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      throw ErrorHandler.createExternalApiError('未收到模型回复', 'DeepSeek');
    }
    
    return reply;
  }

  /**
   * 推理模式聊天完成
   */
  async reasoningCompletion(messages: any[]): Promise<any> {
    const payload = {
      model: 'deepseek-reasoner',
      messages
    };

    const response = await this.post('/chat/completions', payload);
    return response.choices[0].message.reasoning_content;
  }
}