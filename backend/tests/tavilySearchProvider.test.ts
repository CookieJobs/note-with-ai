import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTavilySearchProvider, canonicalizeSourceUrl } from '../services/tavilySearchProvider';
import type { ResearchSource } from '../services/inspirationTypes';

describe('Tavily search provider', () => {
  it('sends one query with raw page content disabled and returns canonical source fields', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createTavilySearchProvider({
      apiKey: 'tvly-test',
      language: 'zh',
      timeoutMs: 500,
      now: () => new Date('2026-09-22T00:00:00.000Z'),
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({
          results: [{
            title: '可信来源',
            url: 'https://example.com/a?utm_source=x&keep=1#part',
            content: '来源摘要',
            raw_content: '不得返回或使用的网页原文',
          }],
        }), { status: 200 });
      },
    });

    const result = await provider.search('测试查询');

    assert.equal(calls[0].url, 'https://api.tavily.com/search');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      query: '测试查询',
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      language: 'zh',
    });
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer tvly-test');
    assert.deepEqual(result, [{
      sourceId: '1',
      canonicalUrl: 'https://example.com/a?keep=1',
      title: '可信来源',
      publisher: 'example.com',
      snippet: '来源摘要',
      retrievedAt: '2026-09-22T00:00:00.000Z',
    } satisfies ResearchSource]);
    assert.equal(JSON.stringify(result).includes('不得返回或使用的网页原文'), false);
  });

  it('drops unsafe URLs and candidates without a title or snippet', async () => {
    const provider = createTavilySearchProvider({
      apiKey: 'tvly-test', language: 'zh', timeoutMs: 500,
      fetchImpl: async () => new Response(JSON.stringify({ results: [
        { title: 'script', url: 'javascript:alert(1)', content: '摘要' },
        { title: 'credentials', url: 'https://user:secret@example.com/a', content: '摘要' },
        { title: 'too long', url: `https://example.com/${'a'.repeat(2050)}`, content: '摘要' },
        { title: '', url: 'https://example.com/empty-title', content: '摘要' },
        { title: 'empty snippet', url: 'https://example.com/empty-snippet', content: '  ' },
      ] }), { status: 200 }),
    });

    assert.deepEqual(await provider.search('查询'), []);
  });

  it('removes tracking fields and rejects unsafe or malformed source URLs', () => {
    assert.equal(canonicalizeSourceUrl('https://example.com/a?utm_campaign=x&gclid=y&keep=1#part'), 'https://example.com/a?keep=1');
    assert.equal(canonicalizeSourceUrl('javascript:alert(1)'), null);
    assert.equal(canonicalizeSourceUrl('https://user:secret@example.com/a'), null);
    assert.equal(canonicalizeSourceUrl('not a URL'), null);
  });

  it('maps Tavily 401 and 429 responses to a safe provider error', async () => {
    for (const status of [401, 429]) {
      const provider = createTavilySearchProvider({
        apiKey: 'tvly-test', language: 'zh', timeoutMs: 500,
        fetchImpl: async () => new Response('secret response body', { status }),
      });

      await assert.rejects(provider.search('private search query'), (error: any) => {
        assert.equal(error.details?.code, 'SEARCH_PROVIDER_FAILED');
        assert.equal(error.details?.originalError, undefined);
        assert.equal(error.message.includes('private search query'), false);
        assert.equal(error.message.includes('secret response body'), false);
        return true;
      });
    }
  });

  it('reports a missing API key without making an HTTP request', async () => {
    let called = false;
    const provider = createTavilySearchProvider({
      apiKey: undefined, language: 'zh', timeoutMs: 500,
      fetchImpl: async () => { called = true; return new Response('{}'); },
    });

    await assert.rejects(provider.search('private query'), (error: any) => error.details?.code === 'SEARCH_PROVIDER_UNAVAILABLE');
    assert.equal(called, false);
  });
});
