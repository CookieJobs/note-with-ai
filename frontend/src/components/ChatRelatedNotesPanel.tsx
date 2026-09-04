import React from 'react';
import type { IRelatedNote } from '../types';
import type { RelationshipContext } from '../app/notes/types/relationships';

interface ChatRelatedNotesPanelProps {
  relatedNotes?: IRelatedNote[];
  relationshipContext?: RelationshipContext | null;
  className?: string;
  onNoteClick?: (noteId: string) => void;
  onRemoveContextNote?: (noteId: string) => void;
}

export const ChatRelatedNotesPanel: React.FC<ChatRelatedNotesPanelProps> = ({ relatedNotes = [], relationshipContext, className = '', onNoteClick, onRemoveContextNote }) => {
  const notes = relationshipContext?.notes || relatedNotes.map((note) => ({ noteId: note.noteId || note.id || '', title: note.title || '无标题', occurredAt: note.createdAt || '', excerpt: note.content || '' }));
  return (
    <aside className={`flex h-full flex-col overflow-hidden bg-white ${className}`} aria-label="关系上下文">
      <div className="shrink-0 border-b border-gray-100 p-6"><h2 className="text-lg font-semibold text-gray-900">{relationshipContext ? '关系上下文' : '相关笔记'}</h2><p className="mt-1 text-xs text-gray-500">{relationshipContext ? '发送前先看看这两个时刻' : '对话中提到的笔记'}</p></div>
      <div className="flex-1 space-y-3 overflow-y-auto p-6">
        {relationshipContext && <p className="rounded-lg bg-gray-50 p-3 text-sm leading-6 text-gray-600">{relationshipContext.relationship.explanation}</p>}
        {notes.length === 0 ? <div className="py-16 text-center text-sm text-gray-500">暂无相关笔记</div> : notes.map((note) => (
          <article key={note.noteId} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-start justify-between gap-2"><button type="button" className="min-h-11 text-left font-medium text-gray-900 underline-offset-2 hover:underline" onClick={() => note.noteId && onNoteClick?.(note.noteId)}>{note.title || '无标题'}</button>{relationshipContext && <button type="button" className="min-h-11 min-w-11 rounded-lg text-xs text-gray-500 hover:bg-gray-200" aria-label={`移除${note.title || '这条笔记'}`} onClick={() => onRemoveContextNote?.(note.noteId)}>移除</button>}</div>
            <p className="mt-2 text-xs text-gray-400">{note.occurredAt ? new Date(note.occurredAt).toLocaleDateString('zh-CN') : ''}</p>
            <blockquote className="mt-2 text-sm leading-6 text-gray-600">“{note.excerpt || '暂无摘录'}”</blockquote>
          </article>
        ))}
      </div>
    </aside>
  );
};

export default ChatRelatedNotesPanel;
