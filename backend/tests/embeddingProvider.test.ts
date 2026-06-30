import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'http://localhost:27017';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-openrouter-key';
process.env.DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || 'test-dashscope-key';
process.env.EMBEDDING_PROVIDER = 'openrouter';
process.env.EMBEDDING_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2:free';
process.env.EMBEDDING_DIMENSION = '2048';

global.setInterval = (((_callback: (...args: any[]) => void, _ms?: number, ..._args: any[]) => {
  return 0 as any;
}) as typeof setInterval);

const manualRestores: Array<() => void> = [];

async function loadModules() {
  return {
    axios: require('axios').default,
    embeddingUtils: require('../utils/embedding') as typeof import('../utils/embedding'),
  };
}

function replaceMethod<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const original = target[key];
  (target as any)[key] = value;
  manualRestores.push(() => {
    (target as any)[key] = original;
  });
}

describe('embedding providers', () => {
  afterEach(() => {
    mock.restoreAll();
    while (manualRestores.length > 0) {
      manualRestores.pop()?.();
    }
  });

  it('generateEmbedding 默认使用 OpenRouter 配置并解析 OpenAI 兼容响应', async () => {
    const { axios, embeddingUtils } = await loadModules();
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

    replaceMethod(axios, 'post', (async (url: string, body: Record<string, unknown>) => {
      requests.push({ url, body });
      return {
        data: {
          data: [{ embedding: [0.11, 0.22, 0.33] }],
        },
      };
    }) as any);

    const embedding = await embeddingUtils.generateEmbedding('用于建立文档向量的文本');

    assert.deepEqual(embedding, [0.11, 0.22, 0.33]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/embeddings');
    assert.equal(requests[0].body.model, 'nvidia/llama-nemotron-embed-vl-1b-v2:free');
    assert.equal(requests[0].body.input_type, 'search_document');
    assert.equal(requests[0].body.dimensions, 2048);
  });

  it('generateEmbeddingsBatch 支持显式 provider/model/inputType/modality 参数', async () => {
    const { axios, embeddingUtils } = await loadModules();
    const requests: Array<Record<string, unknown>> = [];

    replaceMethod(axios, 'post', (async (_url: string, body: Record<string, unknown>) => {
      requests.push(body);
      return {
        data: {
          data: [
            { embedding: [0.1, 0.2] },
            { embedding: [0.3, 0.4] },
          ],
        },
      };
    }) as any);

    const embeddings = await embeddingUtils.generateEmbeddingsBatch(
      ['问题一', '问题二'],
      {
        provider: 'openrouter',
        model: 'custom-embedding-model',
        dimensions: 512,
        inputType: 'search_query',
        modality: 'text',
      }
    );

    assert.deepEqual(embeddings, [
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'custom-embedding-model');
    assert.equal(requests[0].input_type, 'search_query');
    assert.equal(requests[0].dimensions, 512);
    assert.deepEqual(requests[0].input, ['问题一', '问题二']);
  });

  it('getCachedEmbedding 会按 query/document 语义隔离缓存', async () => {
    const { axios, embeddingUtils } = await loadModules();
    const requests: Array<Record<string, unknown>> = [];

    embeddingUtils.clearCache();
    replaceMethod(axios, 'post', (async (_url: string, body: Record<string, unknown>) => {
      requests.push(body);
      return {
        data: {
          data: [{ embedding: [requests.length, 0.2, 0.3] }],
        },
      };
    }) as any);

    const queryEmbedding = await embeddingUtils.getCachedEmbedding('同一段文本', {
      inputType: 'search_query',
      modality: 'text',
    });
    const documentEmbedding = await embeddingUtils.getCachedEmbedding('同一段文本', {
      inputType: 'search_document',
      modality: 'text',
    });
    const cachedQueryEmbedding = await embeddingUtils.getCachedEmbedding('同一段文本', {
      inputType: 'search_query',
      modality: 'text',
    });

    assert.deepEqual(queryEmbedding, [1, 0.2, 0.3]);
    assert.deepEqual(documentEmbedding, [2, 0.2, 0.3]);
    assert.deepEqual(cachedQueryEmbedding, [1, 0.2, 0.3]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].input_type, 'search_query');
    assert.equal(requests[1].input_type, 'search_document');
  });

  it('generateQwenEmbedding 继续兼容 DashScope 响应结构', async () => {
    const { axios, embeddingUtils } = await loadModules();
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

    replaceMethod(axios, 'post', (async (url: string, body: Record<string, unknown>) => {
      requests.push({ url, body });
      return {
        data: {
          output: {
            embeddings: [{ embedding: [0.9, 0.8, 0.7] }],
          },
        },
      };
    }) as any);

    const embedding = await embeddingUtils.generateQwenEmbedding('兼容旧调用链');

    assert.deepEqual(embedding, [0.9, 0.8, 0.7]);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding'
    );
    assert.equal(requests[0].body.model, 'qwen3-vl-embedding');
  });
});
