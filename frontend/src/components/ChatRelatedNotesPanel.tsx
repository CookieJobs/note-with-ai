import React from 'react';
import RelatedNoteCard from './RelatedNoteCard';
import styles from './ChatRelatedNotesPanel.module.scss';
import { IRelatedNote } from '../types';

interface ChatRelatedNotesPanelProps {
  relatedNotes: IRelatedNote[];
  className?: string;
  onNoteClick?: (noteId: string) => void;
}

export const ChatRelatedNotesPanel: React.FC<ChatRelatedNotesPanelProps> = ({
  relatedNotes,
  className = '',
  onNoteClick
}) => {
  // 开发模式下打印日志，方便调试数据更新
  if (process.env.NODE_ENV === 'development') {
    console.log('📝 ChatRelatedNotesPanel received notes:', relatedNotes?.length);
  }

  return (
    <div className={`${styles.panel} ${className}`}>
      <div className={styles.header}>
        <h3>
          <span>🔗</span>
          相关笔记
          {relatedNotes.length > 0 && <span>({relatedNotes.length})</span>}
        </h3>
      </div>

      <div className={styles.scrollArea}>
        {relatedNotes.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.icon}>📝</div>
            <p>暂无相关笔记</p>
            <p className="text-xs mt-2">随着对话进行，这里会显示相关的笔记内容</p>
          </div>
        ) : (
          <div className={styles.list}>
            {relatedNotes.map((note) => (
              <RelatedNoteCard
                key={note.noteId}
                note={{
                  _id: note.noteId,
                  title: note.title,
                  content: note.content || '',
                  similarity: note.score || 0,
                  createdAt: note.createdAt || new Date().toISOString(),
                  keywords: [] // Backend doesn't return keywords yet, but that's fine
                }}
                onExpand={onNoteClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatRelatedNotesPanel;
