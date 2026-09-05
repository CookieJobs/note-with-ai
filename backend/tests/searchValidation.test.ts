import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSafeExternalUrl, normalizeProviderResult } from '../services/searchValidation';

describe('provider-result URL validation', () => {
  it('accepts public HTTP(S) sources and canonicalizes fragments', () => {
    assert.equal(isSafeExternalUrl('https://publisher.example/article?ref=home'), true);
    assert.equal(normalizeProviderResult({
      url: 'https://publisher.example/article#section',
      title: ' 来源文章 ',
      publisher: '出版方',
      snippet: '有来源的摘要材料',
    })?.url, 'https://publisher.example/article');
  });

  it('rejects dangerous schemes, local addresses, metadata hosts, and unusable fields', () => {
    for (const value of [
      'file:///private/secret',
      'data:text/html,unsafe',
      'http://127.0.0.1/admin',
      'http://169.254.169.254/latest/meta-data',
      'http://localhost:3000',
      'https://metadata.google.internal/computeMetadata/v1',
    ]) assert.equal(isSafeExternalUrl(value), false, value);
    assert.equal(normalizeProviderResult({ url: 'https://publisher.example', title: '', snippet: 'x' }), null);
  });
});

