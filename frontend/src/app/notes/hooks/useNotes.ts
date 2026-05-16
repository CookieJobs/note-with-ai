import { useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { JSONContent } from '@tiptap/react';
import { authFetch } from '../../../utils/auth';
import type { IRecommendCache, INote, IUserProfile } from '../../../types';

export type Note = INote & { enriching?: boolean };

type UseNotesOptions = {
  onError?: (message: string) => void;
};

export function useNotes(user: IUserProfile | null, options: UseNotesOptions = {}) {
  const { onError } = options;
  const queryClient = useQueryClient();

  const { data: notes = [], isLoading, error } = useQuery({
    queryKey: ['notes'],
    queryFn: async () => {
      const res = await authFetch('/api/notes');
      if (!res.ok) throw new Error(`请求失败: ${res.status}`);
      const response = await res.json();

      if (response.success && response.data && Array.isArray(response.data.notes)) {
        return response.data.notes as Note[];
      } else if (Array.isArray(response?.notes)) {
        return response.notes as Note[];
      } else {
        console.warn('⚠️ /api/notes 返回格式错误:', response);
        return [];
      }
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (error) {
      console.error('加载失败:', error);
      onError?.('加载失败，请稍后重试');
    }
  }, [error, onError]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/notes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除失败');
      return id;
    },
    onSuccess: (deletedId) => {
      queryClient.setQueryData(['notes'], (old: Note[] | undefined) => {
        if (!old) return [];
        return old.filter((n) => n._id !== deletedId);
      });
    },
    onError: (err) => {
      console.error('删除失败:', err);
      onError?.('删除失败，请稍后重试');
    }
  });

  const setNotes = useCallback((updater: React.SetStateAction<Note[]>) => {
    queryClient.setQueryData(['notes'], updater);
  }, [queryClient]);

  const updateTitle = useCallback((id: string, newTitle: string, updatedAt?: string) => {
    setNotes((prev: Note[] = []) =>
      prev.map((n) => (n._id === id ? { ...n, title: newTitle, updatedAt: updatedAt || n.updatedAt } : n))
    );
  }, [setNotes]);

  const updateContent = useCallback((
    id: string,
    newContent: string,
    updatedAt?: string,
    contentJson?: JSONContent,
    contentText?: string,
    embedding?: number[]
  ) => {
    setNotes((prev: Note[] = []) =>
      prev.map((n) =>
        n._id === id
          ? {
              ...n,
              content: newContent,
              contentText: contentText !== undefined ? contentText : n.contentText,
              contentJson: contentJson !== undefined ? contentJson : n.contentJson,
              updatedAt: updatedAt || n.updatedAt,
              embedding: Array.isArray(embedding) ? embedding : n.embedding,
              recommendCache: null,
            }
          : n
      )
    );
  }, [setNotes]);

  const updateKeywords = useCallback((id: string, newKeywords: string[], updatedAt?: string) => {
    setNotes((prev: Note[] = []) =>
      prev.map((n) => (n._id === id ? { ...n, keywords: newKeywords, updatedAt: updatedAt || n.updatedAt } : n))
    );
  }, [setNotes]);

  const updateRecommendCache = useCallback((id: string, recommendCache: IRecommendCache | null) => {
    setNotes((prev: Note[] = []) =>
      prev.map((n) => (n._id === id ? { ...n, recommendCache } : n))
    );
  }, [setNotes]);

  return {
    notes,
    setNotes, // 给页面保留灵活性（例如快速记录的乐观插入/回滚）
    isLoading,
    deleteNote: deleteMutation.mutateAsync,
    updateTitle,
    updateContent,
    updateKeywords,
    updateRecommendCache,
  };
}
