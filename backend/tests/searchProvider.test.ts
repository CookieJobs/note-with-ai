import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { searchProvider } from '../services/search';

describe('search provider', () => {
  it('fails closed when a provider is not configured', async () => {
    await assert.rejects(() => searchProvider.search('写作', { limit: 3 }), (error: any) => error?.details?.code === 'SEARCH_PROVIDER_UNAVAILABLE');
  });
});

