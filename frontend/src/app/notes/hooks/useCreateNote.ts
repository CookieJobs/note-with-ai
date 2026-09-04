import { useCallback, useState } from 'react';
import { JSONContent } from '@tiptap/react';
import type { CreateNoteCommand, Note } from './useNotes';

type UseCreateNoteOptions = {
  onError?: (message: string) => void;
  onSuccess?: () => void;
};

export function useCreateNote(
  createNote: (command: CreateNoteCommand) => Promise<Note>,
  options: UseCreateNoteOptions = {}
) {
  const { onError, onSuccess } = options;

  const [newContentText, setNewContentText] = useState('');
  const [newContentJson, setNewContentJson] = useState<JSONContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  const handleSubmit = useCallback(async (): Promise<boolean> => {
    const contentText = (newContentText || '').trim();
    if (!contentText || loading) return false;

    setLoading(true);
    onError?.('');

    try {
      await createNote({
        body: newContentJson
          ? { kind: 'rich-text', document: newContentJson as Record<string, unknown> }
          : { kind: 'plain-text', text: contentText },
        optimistic: {
          contentText,
          contentJson: newContentJson as Record<string, unknown> | null,
        },
      });
      setNewContentText('');
      setNewContentJson(null);
      setIsComposing(false);
      onSuccess?.();
      return true;
    } catch (err: unknown) {
      onError?.(err instanceof Error ? err.message : '创建笔记失败，请稍后重试');
      return false;
    } finally {
      setLoading(false);
    }
  }, [createNote, newContentJson, newContentText, loading, onError, onSuccess]);

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
  };
}
