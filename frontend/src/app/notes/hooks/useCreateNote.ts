import { useCallback, useRef, useState } from 'react';
import { authFetch } from '../../../utils/auth';
import { generateUUID } from '../../../utils/uuid';
import type { Note } from '../types';
import type { RelatedNote } from '../../../components/RelatedNoteCard';

type UseCreateNoteOptions = {
  onError?: (message: string) => void;
};

export function useCreateNote(
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>,
  options: UseCreateNoteOptions = {}
) {
  const { onError } = options;

  const [newContentText, setNewContentText] = useState('');
  const [newContentJson, setNewContentJson] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  // 相关笔记状态（在创建后展示）
  const [activeRelatedNoteId, setActiveRelatedNoteId] = useState<string | null>(null);
  const [relatedNotes, setRelatedNotes] = useState<RelatedNote[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [noRelatedFound, setNoRelatedFound] = useState(false);
  const hideRelatedTimerRef = useRef<number | null>(null);

  const clearRelatedSoon = useCallback(() => {
    if (hideRelatedTimerRef.current) {
      window.clearTimeout(hideRelatedTimerRef.current);
      hideRelatedTimerRef.current = null;
    }
    hideRelatedTimerRef.current = window.setTimeout(() => {
      setActiveRelatedNoteId(null);
      setNoRelatedFound(false);
    }, 3000);
  }, []);

  const handleSubmit = useCallback(async () => {
    const contentText = (newContentText || '').trim();
    if (!contentText || loading) return;

    setLoading(true);
    onError?.('');

    // 乐观插入临时笔记并标记富化中
    const tempId = 'temp-' + generateUUID();
    const tempNote: Note = {
      _id: tempId,
      title: '',
      content: contentText,
      contentText: contentText,
      contentJson: newContentJson ?? undefined,
      keywords: [],
      createdAt: new Date().toISOString(),
      enriching: true,
    };
    setNotes((prev) => [tempNote, ...prev]);

    try {
      const res = await authFetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentText, contentJson: newContentJson }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`创建失败: ${res.status} ${txt}`);
      }

      const data = await res.json();
      const created: Note | undefined = (data?.success && data?.data) ? data.data : data;

      if (created && created._id) {
        setNotes((prev) => prev.map((n) => (n._id === tempId ? ({ ...created, enriching: true } as Note) : n)));
        setNewContentText('');
        setNewContentJson(null);
        setIsComposing(false);

        // 获取相关笔记
        setActiveRelatedNoteId(created._id);
        setRelatedNotes([]);
        setNoRelatedFound(false);
        setRelatedLoading(true);

        // 1. 异步生成 embedding，不阻塞相关笔记查询（因为查询用的是文本）
        authFetch(`/api/notes/${created._id}/embed`, { method: 'POST' })
          .then((r) => r.json())
          .then((embedData) => {
            const emb = embedData?.data?.embedding;
            if (Array.isArray(emb) && emb.length > 0) {
              setNotes((prev) => prev.map((n) => (n._id === created._id ? ({ ...n, embedding: emb } as Note) : n)));
            }
          })
          .catch(console.error);

        // 1.5 异步生成标题与关键词（内容不变也触发）
        // 优化：仅发送 autoSummarize: true，不发送 contentText，避免大报文和覆盖风险
        // 后端会自动使用 DB 里的内容进行摘要
        authFetch(`/api/notes/${created._id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoSummarize: true }),
        })
          .then((r) => r.json())
          .then((patchData) => {
            const updated = patchData?.data?.note;
            if (updated && updated._id === created._id) {
              setNotes((prev) =>
                prev.map((n) =>
                  n._id === created._id
                    ? {
                        ...n,
                        title: typeof updated.title === 'string' ? updated.title : n.title,
                        keywords: Array.isArray(updated.keywords) ? updated.keywords : n.keywords,
                        enriching: false,
                        updatedAt: updated.updatedAt || n.updatedAt,
                      }
                    : n
                )
              );
            } else {
              setNotes((prev) => prev.map((n) => (n._id === created._id ? { ...n, enriching: false } : n)));
            }
          })
          .catch(() => {
            setNotes((prev) => prev.map((n) => (n._id === created._id ? { ...n, enriching: false } : n)));
          });

        // 2. 查询相关笔记
        authFetch('/api/chat/related-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: created.contentText || created.content,
            excludeNoteId: created._id,
            limit: 3,
            threshold: 0.3, // 显式降低阈值
          }),
        })
          .then((r) => r.json())
          .then((relatedData) => {
            if (relatedData.success && Array.isArray(relatedData.data?.relatedNotes)) {
              const list = relatedData.data.relatedNotes;
              if (list.length > 0) {
                const formattedNotes = list.map((item: any) => ({
                  ...item.note,
                  similarity: item.score,
                }));
                setRelatedNotes(formattedNotes);
              } else {
                setNoRelatedFound(true);
                clearRelatedSoon();
              }
            } else {
              setNoRelatedFound(true);
              clearRelatedSoon();
            }
          })
          .catch((err) => {
            console.error('获取相关笔记失败:', err);
            setNoRelatedFound(true);
            clearRelatedSoon();
          })
          .finally(() => setRelatedLoading(false));

      } else {
        console.warn('未知的创建返回结构:', data);
      }
    } catch (err: any) {
      console.error('创建笔记失败:', err);
      onError?.(err?.message || '创建笔记失败，请稍后重试');
      // 回滚临时笔记
      setNotes((prev) => prev.filter((n) => n._id !== tempId));
    } finally {
      setLoading(false);
    }
  }, [newContentJson, newContentText, loading, onError, setNotes, clearRelatedSoon]);

  // 键盘快捷键 Cmd/Ctrl + Enter 提交
  return {
    newContentText,
    setNewContentText,
    newContentJson,
    setNewContentJson,
    loading,
    isComposing,
    setIsComposing,
    handleSubmit,
    // related notes
    activeRelatedNoteId,
    relatedNotes,
    relatedLoading,
    noRelatedFound,
  };
}


