import { describe, expect, it } from 'vitest';
import type { IChat } from '../types';
import { getChatHistoryLabel, matchesChatHistoryQuery } from './chatHistory';

const base: IChat = { id: 'chat', title: '新对话', messages: [] };

describe('conversation history identity and search', () => {
  it('keeps explicit titles', () => {
    expect(getChatHistoryLabel({ ...base, title: '我的产品复盘' })).toBe(
      '我的产品复盘',
    );
  });

  it('prefers a readable care source, including a message-level source', () => {
    const session: IChat = {
      ...base,
      relatedNotes: [{ noteId: 'other', title: '其他相关记录' }],
      messages: [
        {
          role: 'assistant',
          content: '开场白',
          relatedNotes: [
            {
              noteId: 'source',
              title: '飞书日历设置',
              matchType: 'care_source',
            },
          ],
        },
      ],
    };
    expect(getChatHistoryLabel(session)).toBe('飞书日历设置');
    expect(matchesChatHistoryQuery(session, ' 飞书 ')).toBe(true);
  });

  it('uses readable untitled source text', () => {
    expect(
      getChatHistoryLabel({
        ...base,
        relatedNotes: [{ noteId: 'one', title: '', excerpt: '骑车回家的想法' }],
      }),
    ).toBe('骑车回家的想法');
  });

  it('does not let an image or ID-only placeholder hide a meaningful user message', () => {
    const session: IChat = {
      ...base,
      relatedNotes: [
        { noteId: 'image', title: '', sourceType: 'image', imageCount: 1 },
      ],
      messages: [
        { role: 'assistant', content: '通用开场' },
        { role: 'user', content: '  如何\n整理笔记？  ' },
      ],
    };
    expect(getChatHistoryLabel(session)).toBe('如何 整理笔记？');
  });

  it('uses an assistant message only when there is no useful user message or source', () => {
    expect(
      getChatHistoryLabel({
        ...base,
        title: '新会话',
        messages: [{ role: 'assistant', content: '聊聊最近的想法' }],
      }),
    ).toBe('聊聊最近的想法');
    expect(getChatHistoryLabel(base)).toBe('新对话');
  });

  it('truncates fallback labels by Unicode code points', () => {
    expect(
      getChatHistoryLabel({
        ...base,
        messages: [{ role: 'user', content: '🌱'.repeat(50) }],
      }),
    ).toBe('🌱'.repeat(48) + '…');
  });

  it('searches original titles, full message text and both source levels case-insensitively', () => {
    const session: IChat = {
      ...base,
      relatedNotes: [
        {
          noteId: 'one',
          title: '来源标题',
          excerpt: '来源摘录',
          content: '来源正文',
        },
      ],
      messages: [
        {
          role: 'user',
          content: '完整消息中的 TypeScript',
          relatedNotes: [
            {
              noteId: 'two',
              title: '消息来源',
              excerpt: '消息摘录',
              content: '消息来源正文',
            },
          ],
        },
      ],
    };
    for (const query of [
      '新对话',
      'typescript',
      '来源标题',
      '来源摘录',
      '来源正文',
      '消息来源',
      '消息摘录',
      '消息来源正文',
      '  ',
    ]) {
      expect(matchesChatHistoryQuery(session, query), query).toBe(true);
    }
    expect(matchesChatHistoryQuery(session, '并不存在')).toBe(false);
  });
});
