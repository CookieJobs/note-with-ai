import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchChatSessionsRemote, mergeChatSessions, readChatSessionsFromStorage, saveChatSessionRemote } from './chatSessionStore';
import type { IChat } from '../types';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../utils/auth', () => ({ authFetch }));

const snapshot = { noteId: 'note-1', title: '学习安排', contentText: '周三20分钟', revision: 3, updatedAt: '2026-10-18T01:00:00.000Z', hasImages: false };

describe('single-note session storage', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('sends a binding but never re-submits a cached answer snapshot as client authority', async () => {
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { sessionId: 'saved-1' } }) });
    const session = { id: 'local_1', title: '学习', sourceNoteId: 'note-1', messages: [{ role: 'assistant', content: '回答', sourceSnapshot: snapshot }] } as IChat;

    await saveChatSessionRemote(session);

    const payload = JSON.parse(authFetch.mock.calls[0][1].body);
    expect(payload.sourceNoteId).toBe('note-1');
    expect(payload.messages).toEqual([{ role: 'assistant', content: '回答' }]);
  });

  it('restores the server binding and snapshot when a longer local transcript is merged with history', () => {
    const server = { id: 'saved-1', title: '学习', sourceNoteId: 'note-1', messages: [{ role: 'assistant', content: '回答', sourceSnapshot: snapshot }] } as IChat;
    const local: IChat = { id: 'saved-1', title: '学习', messages: [{ role: 'assistant', content: '回答' }, { role: 'user', content: '继续问' }] };
    const merged = mergeChatSessions([server], [local]);
    localStorage.setItem('chat_sessions_user-1', JSON.stringify(merged));

    const restored = readChatSessionsFromStorage('user-1')[0];
    expect(restored).toMatchObject({ sourceNoteId: 'note-1' });
    expect(restored.messages[0]).toMatchObject({ sourceSnapshot: snapshot });
    expect(restored.messages.at(-1)?.content).toBe('继续问');
  });

  it('keeps accepted server answer text when the longer cache still contains a partial streamed answer', () => {
    const server = { id: 'saved-1', title: '学习', sourceNoteId: 'note-1', messages: [{ role: 'assistant', content: '已保存的完整回答', sourceSnapshot: snapshot }] } as IChat;
    const local: IChat = { id: 'saved-1', title: '学习', messages: [{ role: 'assistant', content: '未完成的片段' }, { role: 'user', content: '继续问' }] };

    const merged = mergeChatSessions([server], [local])[0];

    expect(merged.messages).toEqual([
      { role: 'assistant', content: '已保存的完整回答', sourceSnapshot: snapshot },
      { role: 'user', content: '继续问' },
    ]);
  });
});

describe('multi-note discovery session migration', () => {
 it('retains binding and every server snapshot through normalization, merge and cache; strips both snapshot fields from writes', async () => {
  const second = {...snapshot, noteId:'note-2',revision:7};
  const server: IChat = {id:'discovery-session', title:'联系', sourceMode:'multi_note_discovery',discoveryId:'finding',selectedSourceIds:['note-1','note-2'],messages:[{role:'assistant',content:'完整回答',sourceSnapshots:[snapshot,second]}]};
  const local: IChat = {...server,messages:[{role:'assistant',content:'片段'}, {role:'user',content:'继续'}]};
  const merged = mergeChatSessions([server],[local]);
  localStorage.setItem('chat_sessions_multi',JSON.stringify(merged));
  expect(readChatSessionsFromStorage('multi')[0]).toMatchObject({...server,messages:[server.messages[0],local.messages[1]]});
  authFetch.mockResolvedValue({ok:true,json:async()=>({data:{sessionId:server.id}})});
  await saveChatSessionRemote(server);
  const body=JSON.parse(authFetch.mock.calls.at(-1)![1].body);
  expect(body.messages).toEqual([{role:'assistant',content:'完整回答'}]);
  expect(body).not.toHaveProperty('discoveryId');
  expect(body).not.toHaveProperty('sourceSnapshots');
 });
});


it('normalizes remote discovery identities without dropping multi-note evidence', async () => {
 const remote={_id:'remote-discovery',title:'联系',sourceMode:'multi_note_discovery',discoveryId:'finding',messages:[{role:'assistant',content:'回答',sourceSnapshots:[snapshot,{...snapshot,noteId:'note-2'}]}]};
 authFetch.mockResolvedValue({ok:true,json:async()=>({success:true,data:{sessions:[remote]}})});
 const sessions=await fetchChatSessionsRemote();
 expect(sessions[0]).toMatchObject({...remote,id:'remote-discovery'});
 expect(sessions[0].messages[0].sourceSnapshots).toHaveLength(2);
});
