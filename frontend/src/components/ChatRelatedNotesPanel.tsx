import React from 'react';
import { FileSearch } from 'lucide-react';
import { IRelatedNote } from '../types';
import ReferenceNote from './ReferenceNote';
import styles from './RelatedNotes.module.scss';

interface ChatRelatedNotesPanelProps {
  relatedNotes: IRelatedNote[];
  className?: string;
  onNoteClick?: (noteId: string) => void;
}

export default function ChatRelatedNotesPanel({
  relatedNotes,
  className = '',
  onNoteClick,
}: ChatRelatedNotesPanelProps) {
  const similarityLabel = (score: number) =>
    score >= 0.9
      ? '高度相关'
      : score >= 0.8
        ? '相关'
        : score >= 0.7
          ? '可能相关'
          : '弱相关';
  return (
    <section className={`${styles.panel} ${className}`} aria-label="相关笔记">
      <div className={styles.header}>
        <h2>
          相关笔记{' '}
          <span className={styles.count}>{relatedNotes.length || ''}</span>
        </h2>
      </div>
      <p className={styles.intro}>发现对话线索。回答实际采用的内容见“本次回答依据”。</p>
      <div className={styles.list}>
        {relatedNotes.length === 0 ? (
          <div className={styles.empty}>
            <FileSearch size={24} strokeWidth={1.5} />
            <h3>暂无相关笔记</h3>
            <p>对话中提到的相关记录会出现在这里。</p>
          </div>
        ) : (
          relatedNotes.map((note, index) => {
            const noteId = note.noteId || note.id || '';
            const score =
              typeof note.score === 'number'
                ? note.score
                : note.similarity || 0;
            return (
              <ReferenceNote
                key={`${noteId}-${index}`}
                title={note.title}
                content={note.content}
                excerpt={note.excerpt}
                sourceType={note.sourceType}
                imageCount={note.imageCount}
                firstImageSrc={note.firstImageSrc}
                createdAt={note.createdAt}
                matchType={note.matchType}
                createdAtSource={note.createdAtSource}
                relation={similarityLabel(score)}
                reason={note.reason}
                onOpen={
                  noteId && onNoteClick ? () => onNoteClick(noteId) : undefined
                }
              />
            );
          })
        )}
      </div>
    </section>
  );
}
