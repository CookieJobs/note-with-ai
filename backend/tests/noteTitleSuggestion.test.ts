import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { prepareTitleSource, validateSuggestedTitle } from '../services/noteTitleSuggestionService';

const plain = (text: string) => ({ kind: 'plain-text', text });

describe('note title source and result contracts', () => {
  it('normalizes submitted text and fingerprints that exact source', () => {
    const result = prepareTitleSource(plain('  今天写作  \r\n\r\n\r\n 明天修改  '));
    assert.equal(result.text, '今天写作  \n\n 明天修改');
    assert.match(result.sourceFingerprint, /^[a-f0-9]{64}$/);
  });
  it('rejects invalid, empty, overlong, and image-only source', () => {
    for (const value of [null, {}, plain('  '), {kind:'plain-text',text:3}]) assert.throws(() => prepareTitleSource(value));
    assert.equal(prepareTitleSource(plain('a'.repeat(12000))).text.length, 12000);
    assert.throws(() => prepareTitleSource(plain('a'.repeat(12001))), (error: any) => error.code === 'NOTE_TITLE_INPUT_TOO_LONG');
    assert.throws(() => prepareTitleSource({kind:'rich-text',document:{type:'doc',content:[{type:'image',attrs:{src:'x',alt:'cat'}}]}}), (error: any) => error.code === 'NOTE_TITLE_TEXT_UNAVAILABLE');
    assert.equal(prepareTitleSource({kind:'rich-text',document:{type:'doc',content:[{type:'image',attrs:{src:'x'}},{type:'paragraph',content:[{type:'text',text:'真正正文'}]}]}}).text, '真正正文');
  });
  it('requires exactly a single-line title at most 60 code points', () => {
    assert.equal(validateSuggestedTitle({title:'  标题  '}), '标题');
    assert.equal(validateSuggestedTitle({title:'😀'.repeat(60)}), '😀'.repeat(60));
    for (const result of [null, '标题', {}, {title:''}, {title:'a\nb'}, {title:'\nHeading\n'}, {title:'Heading\n'}, {title:'😀'.repeat(61)}, {title:'a',extra:1}]) assert.throws(() => validateSuggestedTitle(result));
  });
});

import { randomUUID } from 'node:crypto';
import { NoteTitleSuggestionService, TitleSuggestionError } from '../services/noteTitleSuggestionService';
import type { TitleQuotaStore } from '../services/noteTitleQuotaService';

const uuid = () => randomUUID();
const fakeQuota = (): { quota: TitleQuotaStore; attempts: () => number; releases: () => number } => {
  let count = 0, released = 0;
  return { quota: { acquire: async () => {
    count++;
    return { permit: { ownerToken: String(count), release: async () => { released++; } } };
  } }, attempts: () => count, releases: () => released };
};

describe('title suggestion transport', () => {
  it('rejects bad request id before quota or provider, and returns normalized fingerprint on success', async () => {
    const quota = fakeQuota();
    let sent = '';
    const service = new NoteTitleSuggestionService({ quota: quota.quota, hasProvider: () => true, provider: async (text) => { sent = text; return { value: {title:'  我的标题  '} }; } });
    await assert.rejects(service.suggest({userId:'u',body:plain('正文') as any,clientRequestId:'bad'}), (e: any) => e.code === 'NOTE_TITLE_INPUT_INVALID');
    assert.equal(quota.attempts(), 0);
    const result = await service.suggest({userId:'u',body:plain('  正文  ') as any,clientRequestId:uuid()});
    assert.equal(sent, '正文');
    assert.equal(result.title, '我的标题');
    assert.equal(result.sourceFingerprint, prepareTitleSource(plain('正文')).sourceFingerprint);
    assert.equal(quota.releases(), 1);
  });
  it('counts failed calls and retains process slots until ignored abort transport settles', async () => {
    const quota = fakeQuota();
    const callbacks: Array<(value: any) => void> = [];
    const provider = async () => new Promise<any>((resolve) => { callbacks.push(resolve); });
    const service = new NoteTitleSuggestionService({ quota: quota.quota, hasProvider: () => true, provider, deadlineMs: 15 });
    const first = service.suggest({userId:'a',body:plain('正文') as any,clientRequestId:uuid()});
    const second = service.suggest({userId:'b',body:plain('正文') as any,clientRequestId:uuid()});
    const firstCheck = assert.rejects(first, (e: any) => e.code === 'NOTE_TITLE_GENERATION_TIMEOUT');
    const secondCheck = assert.rejects(second, (e: any) => e.code === 'NOTE_TITLE_GENERATION_TIMEOUT');
    await Promise.all([firstCheck, secondCheck]);
    assert.equal(quota.attempts(), 2);
    assert.equal(quota.releases(), 2);
    await assert.rejects(service.suggest({userId:'c',body:plain('正文') as any,clientRequestId:uuid()}), (e: any) => e.code === 'NOTE_TITLE_RATE_LIMITED');
    callbacks.forEach(resolve => resolve({value:{title:'late'}}));
    await new Promise(resolve => setTimeout(resolve, 0));
    const replacement = new NoteTitleSuggestionService({quota:quota.quota,hasProvider:()=>true,provider:async()=>({value:{title:'新标题'}})});
    assert.equal((await replacement.suggest({userId:'d',body:plain('正文') as any,clientRequestId:uuid()})).title, '新标题');
  });
  it('rejects an already-expired absolute deadline before quota or provider', async () => {
    const quota = fakeQuota();
    let called = false;
    const service = new NoteTitleSuggestionService({quota:quota.quota,hasProvider:()=>true,provider:async()=>{called=true;return {value:{title:'x'}};}});
    await assert.rejects(service.suggest({userId:'u',body:plain('正文') as any,clientRequestId:uuid(),deadlineAt:Date.now()-1}),(e:any)=>e.code==='NOTE_TITLE_GENERATION_TIMEOUT');
    assert.equal(quota.attempts(),0);
    assert.equal(called,false);
  });
  it('fails closed on storage failure', async () => {
    let called = false;
    const service = new NoteTitleSuggestionService({quota:{acquire:async()=>{throw Error('db');}},hasProvider:()=>true,provider:async()=>{called=true;return {value:{title:'x'}};}});
    await assert.rejects(service.suggest({userId:'u',body:plain('正文') as any,clientRequestId:uuid()}), (e: any) => e.code === 'NOTE_TITLE_PROVIDER_UNAVAILABLE');
    assert.equal(called, false);
  });
});

describe('quota acquisition deadline', () => {
  it('times out before provider and releases a reservation arriving later', async () => {
    let complete!: (value:any) => void;
    let released = 0, called = false;
    const quota: TitleQuotaStore = {acquire:()=>new Promise(resolve=>{complete=resolve;})};
    const service = new NoteTitleSuggestionService({quota,hasProvider:()=>true,deadlineMs:5,provider:async()=>{called=true;return {value:{title:'x'}};}});
    await assert.rejects(service.suggest({userId:'u',body:plain('正文') as any,clientRequestId:uuid()}),(e:any)=>e.code==='NOTE_TITLE_GENERATION_TIMEOUT');
    complete({permit:{ownerToken:'late',release:async()=>{released++;}}});
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(released,1);
    assert.equal(called,false);
  });
});

describe('DeepSeek transport deadline', () => {
  it('makes one fetch attempt and aborts while reading the response body', async () => {
    const { deepSeekTitleProvider } = await import('../services/noteTitleSuggestionService');
    let calls = 0, aborted = false;
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: any, init: any) => {
      calls++;
      assert.equal(JSON.parse(init.body).max_tokens,200);
      return {ok:true,json:()=>new Promise((_resolve,reject)=>{
        init.signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true});
      })} as any;
    }) as any;
    try {
      const quota = fakeQuota();
      const service = new NoteTitleSuggestionService({quota:quota.quota,hasProvider:()=>true,provider:deepSeekTitleProvider,deadlineMs:10});
      await assert.rejects(service.suggest({userId:'u',body:plain('正文') as any,clientRequestId:uuid()}),(e:any)=>e.code==='NOTE_TITLE_GENERATION_TIMEOUT');
      await new Promise(resolve=>setTimeout(resolve,0));
      assert.equal(calls,1);
      assert.equal(aborted,true);
    } finally { globalThis.fetch = original; }
  });
});

describe('cleanup latency', () => {
  it('returns provider result without waiting for a stuck quota release', async () => {
    const quota: TitleQuotaStore = {acquire:async()=>({permit:{ownerToken:'owned',release:()=>new Promise<void>(()=>undefined)}})};
    const service = new NoteTitleSuggestionService({quota,hasProvider:()=>true,provider:async()=>({value:{title:'标题'}}),deadlineMs:20});
    const result = await service.suggest({userId:'u',body:plain('正文') as any,clientRequestId:uuid()});
    assert.equal(result.title,'标题');
  });
});
