import { describe, expect, it, vi } from 'vitest';
import { fetchRelatedNoteSummaries } from './relatedNotes';

describe('fetchRelatedNoteSummaries', () => {
  it('accepts only the public related-summary envelope', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { notes: [{ noteId: 'note-2', title: '列表外笔记', contentText: '可独立读取', type: '强关联', reason: '同一主题', revision: 2 }] },
      }),
    });

    await expect(fetchRelatedNoteSummaries('note-1', fetcher)).resolves.toEqual([{
      noteId: 'note-2', title: '列表外笔记', contentText: '可独立读取', type: '强关联', reason: '同一主题', revision: 2,
    }]);
    expect(fetcher).toHaveBeenCalledWith('/api/recommend/notes/note-1');
  });

  it('rejects a malformed successful envelope', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { notes: [{}] } }) });
    await expect(fetchRelatedNoteSummaries('note-1', fetcher)).rejects.toThrow('关联笔记读取响应无效');
  });
});
