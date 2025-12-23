/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
import React from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './ChatMessage.module.scss';
import Link from 'next/link';

interface RelatedNote {
  id: string;
  title: string;
  content: string;
  similarity: number;
  matchType: string;
  createdAt: string;
}

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  relatedNotes?: RelatedNote[];
  searchingNotes?: boolean;
}

export default function ChatMessage({ role, content, relatedNotes, searchingNotes }: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div className={styles.messageWrapper}>
      {isUser ? (
        // 用户消息：使用卡片包装
        <div className={styles.userMessageCard}>
          <div className={styles.userMessage}>
            {content}
          </div>
        </div>
      ) : (
        // AI消息：直接渲染内容，支持Markdown
        <div className={styles.assistantMessage}>
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      )}
      
      {/* 显示搜索中的loading提示 - 只在AI回复且正在搜索时显示 */}
      {!isUser && searchingNotes && (
        <div className={styles.searchingNotesContainer}>
          <div className={styles.searchingIndicator}>
            <div className={styles.loadingDots}>
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span className={styles.searchingText}>正在从笔记中寻找相关内容...</span>
          </div>
        </div>
      )}
      
      {/* 显示相关笔记 - 只在AI回复且有相关笔记时显示 */}
      {!isUser && Array.isArray(relatedNotes) && relatedNotes.length > 0 && (
        <div className={styles.relatedNotesContainer}>
          <div className={styles.relatedNotesHeader}>
            📝 相关笔记 ({relatedNotes.length})
          </div>
          <div className={styles.relatedNotesList}>
            {relatedNotes.map((note) => {
              const safeTitle = (note && typeof note.title === 'string' && note.title.trim()) ? note.title : '无标题';
              const rawContent = (note && typeof note.content === 'string') ? note.content : '';
              const preview = rawContent.length > 200 ? rawContent.substring(0, 200) + '...' : rawContent;
              const similarity = Number.isFinite(note?.similarity) ? Math.round((note!.similarity as number) * 100) : 0;
              const date = note?.createdAt ? new Date(note.createdAt) : null;
              const dateText = (date && !isNaN(date.getTime())) ? date.toLocaleDateString('zh-CN') : '-';
              const safeId = (note as any)?.id || (note as any)?._id || '';
              const key = safeId || `${safeTitle}-${dateText}`;

              const cardInner = (
                <>
                  <div className={styles.noteHeader}>
                    <span className={styles.noteTitle}>{safeTitle}</span>
                    <span className={styles.noteSimilarity}>
                      {similarity}% 相关
                    </span>
                  </div>
                  <div className={styles.noteContent}>{preview}</div>
                  <div className={styles.noteFooter}>
                    <span className={styles.noteDate}>{dateText}</span>
                  </div>
                </>
              );

              return safeId ? (
                <Link
                  key={key}
                  href={`/notes?highlight=${encodeURIComponent(safeId)}`}
                  prefetch={false}
                  className={styles.relatedNoteItem}
                  aria-label={`查看笔记详情：${safeTitle}`}
                >
                  {cardInner}
                </Link>
              ) : (
                <div key={key} className={styles.relatedNoteItem}>
                  {cardInner}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
