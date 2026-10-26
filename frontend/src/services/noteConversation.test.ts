import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startNoteConversation } from './noteConversation';
const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../utils/auth', () => ({ authFetch }));
describe('startNoteConversation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('saves only the selected source and empty messages before returning its real ID', async () => {
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { sessionId: 'server-note' } }) });
    await expect(startNoteConversation('note-1', '学习安排')).resolves.toBe('server-note');
    expect(authFetch).toHaveBeenCalledOnce();
    expect(authFetch.mock.calls[0][0]).toBe('/api/chat/save');
    expect(JSON.parse(authFetch.mock.calls[0][1].body)).toEqual({ title: '学习安排', sourceNoteId: 'note-1', messages: [] });
  });
  it.each([{ ok: false, data: { message: '来源已删除' } }, { ok: true, data: { data: { sessionId: '' } } }, { ok: true, data: { data: { sessionId: 'local_fake' } } }])('rejects an unaccepted or invalid ID: %j', async ({ ok, data }) => {
    authFetch.mockResolvedValue({ ok, json: async () => data });
    await expect(startNoteConversation('note-1')).rejects.toThrow();
  });
});
