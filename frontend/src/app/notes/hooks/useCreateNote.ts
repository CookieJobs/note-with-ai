import { useCallback, useState } from 'react';
import { JSONContent } from '@tiptap/react';
import type { CreateNoteCommand, Note } from './useNotes';

type UseCreateNoteOptions = {
  onError?: (message: string) => void;
};

export function useCreateNote(
  createNote: (command: CreateNoteCommand) => Promise<Note>,
  options: UseCreateNoteOptions = {}
) {
  const { onError } = options;

  const [newContentText, setNewContentText] = useState('');
  const [newContentJson, setNewContentJson] = useState<JSONContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  const handleSubmit = useCallback(async () => {
    const contentText = (newContentText || '').trim();
    if (!contentText || loading) return;

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
    } catch (err: unknown) {
      onError?.(err instanceof Error ? err.message : '创建笔记失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [createNote, newContentJson, newContentText, loading, onError]);

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
