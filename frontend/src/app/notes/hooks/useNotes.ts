import { useEffect, useState } from 'react';
import { authFetch } from '../../../utils/auth';
import type { Note } from '../types';

type UseNotesOptions = {
  onError?: (message: string) => void;
};

export function useNotes(user: any | null, options: UseNotesOptions = {}) {
  const { onError } = options;

  const [notes, setNotes] = useState<Note[]>([]);

  // 加载笔记列表（随 user 就绪触发）
  useEffect(() => {
    if (!user) return;

    const controller = new AbortController();
    let mounted = true;

    authFetch('/api/notes', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`请求失败: ${res.status}`);
        return res.json();
      })
      .then((response) => {
        if (!mounted) return;

        if (response.success && response.data && Array.isArray(response.data.notes)) {
          setNotes(response.data.notes);
        } else if (Array.isArray(response?.notes)) {
          setNotes(response.notes);
        } else {
          console.warn('⚠️ /api/notes 返回格式错误:', response);
          setNotes([]);
        }
      })
      .catch((err: any) => {
        if (err?.name === 'AbortError') return;
        console.error('加载失败:', err);
        onError?.('加载失败，请稍后重试');
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [user, onError]);

  const deleteNote = async (id: string) => {
    try {
      const res = await authFetch(`/api/notes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除失败');
      setNotes((prev) => prev.filter((n) => n._id !== id));
    } catch (err) {
      console.error('删除失败:', err);
      onError?.('删除失败，请稍后重试');
    }
  };

  const updateTitle = (id: string, newTitle: string) => {
    setNotes((prev) => prev.map((n) => (n._id === id ? { ...n, title: newTitle } : n)));
  };

  const updateContent = (id: string, newContent: string, updatedAt?: string, contentJson?: any, contentText?: string) => {
    setNotes((prev) =>
      prev.map((n) =>
        n._id === id
          ? {
              ...n,
              content: newContent,
              contentText: contentText !== undefined ? contentText : n.contentText,
              contentJson: contentJson !== undefined ? contentJson : n.contentJson,
              updatedAt: updatedAt || n.updatedAt,
            }
          : n
      )
    );
  };

  const updateKeywords = (id: string, newKeywords: string[], updatedAt?: string) => {
    setNotes((prev) =>
      prev.map((n) => (n._id === id ? { ...n, keywords: newKeywords, updatedAt: updatedAt || n.updatedAt } : n))
    );
  };

  return {
    notes,
    setNotes, // 给页面保留灵活性（例如快速记录的乐观插入/回滚）
    deleteNote,
    updateTitle,
    updateContent,
    updateKeywords,
  };
}


