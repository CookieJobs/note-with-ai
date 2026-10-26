/*
Input: 用户明确选中的笔记 ID 与可选标题
Output: 服务端接受的空绑定会话 ID；保存失败时拒绝，不生成 AI 开场
Pos: frontend/src/services
*/
import { createLocalSessionId, saveChatSessionRemote } from '../hooks/chatSessionStore';

export async function startNoteConversation(noteId: string, title?: string): Promise<string> {
  const sourceNoteId = noteId.trim();
  if (!sourceNoteId) throw new Error('请选择来源笔记');
  const id = await saveChatSessionRemote({
    id: createLocalSessionId(), title: title?.trim() || '笔记对话', sourceNoteId, messages: [],
  });
  if (typeof id !== 'string' || !id.trim() || id.startsWith('local_')) throw new Error('保存会话未返回有效记录，请重试');
  return id;
}
