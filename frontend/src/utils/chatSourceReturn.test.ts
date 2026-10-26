import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberChatSourceReturn, takeChatSourceReturn } from './chatSourceReturn';

describe('source conversation return context', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('restores a source visit only once and only for the account that opened it', () => {
    rememberChatSourceReturn({ userId: 'alice', sessionId: 'alice-chat', draft: '未发送的问题', scrollTop: 320 });
    expect(takeChatSourceReturn('bob')).toBeNull();
    expect(takeChatSourceReturn('alice')).toEqual({
      userId: 'alice', sessionId: 'alice-chat', draft: '未发送的问题', scrollTop: 320,
      savedAt: new Date('2026-10-17T12:00:00Z').getTime(),
    });
    expect(takeChatSourceReturn('alice')).toBeNull();
  });

  it('does not reopen a stale source visit after the user has moved on', () => {
    rememberChatSourceReturn({ userId: 'alice', sessionId: 'alice-chat', draft: '', scrollTop: 0 });
    vi.setSystemTime(new Date('2026-10-17T13:00:00Z'));
    expect(takeChatSourceReturn('alice')).toBeNull();
  });

  it.each([
    'broken json',
    JSON.stringify({ userId: 'bob', sessionId: 'bob-chat', draft: '', scrollTop: 0, savedAt: new Date('2026-10-17T12:00:00Z').getTime() }),
    JSON.stringify({ userId: 'alice', sessionId: 'alice-chat', draft: '', scrollTop: -1, savedAt: new Date('2026-10-17T12:00:00Z').getTime() }),
  ])('ignores invalid or mismatched stored return context', (raw) => {
    sessionStorage.setItem('chat_source_return:alice', raw);
    expect(takeChatSourceReturn('alice')).toBeNull();
  });
});
