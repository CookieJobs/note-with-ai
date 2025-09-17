import React, { useState } from 'react';
import styles from './NoteCard.module.scss';
import TrashIcon from './icons/TrashIcon';

interface Note {
  _id: string;
  title: string;
  content: string;
  keywords: string[];
  createdAt: string;
}

interface ModernNoteCardProps {
  note: Note;
  onDelete: (id: string) => void;
}

export const ModernNoteCard: React.FC<ModernNoteCardProps> = ({ note, onDelete }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) return '今天';
    if (diffDays === 2) return '昨天';
    if (diffDays <= 7) return `${diffDays - 1} 天前`;
    if (diffDays <= 30) return `${Math.ceil(diffDays / 7)} 周前`;
    if (diffDays <= 365) return `${Math.ceil(diffDays / 30)} 个月前`;
    return `${Math.ceil(diffDays / 365)} 年前`;
  };

  const getContentPreview = (content?: string, maxLength: number = 150) => {
    const text = content || '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (!note?._id) return;
    onDelete(note._id);
    setShowDeleteConfirm(false);
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const contentText = note?.content || '';
  const keywords = Array.isArray(note?.keywords) ? note.keywords.filter(Boolean) : [];

  return (
    <>
      <div 
        className={styles.noteCard}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* 卡片头部 */}
        <div className={styles.cardHeader}>
          <div className={styles.noteIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="10,9 9,9 8,9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className={styles.cardMeta}>
            <span className={styles.timestamp}>{formatDate(note?.createdAt)}</span>
            <button 
              className={styles.deleteButton}
              onClick={handleDeleteClick}
              title="删除笔记"
              aria-label="删除笔记"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        </div>

        {/* 标题 */}
        {note?.title && (
          <h3 className={styles.noteTitle}>{note.title}</h3>
        )}

        {/* 内容 */}
        <div className={styles.noteContent}>
          <p className={styles.contentText}>
            {isExpanded ? contentText : getContentPreview(contentText)}
          </p>
          {(contentText.length > 150) && (
            <button className={styles.expandButton}>
              {isExpanded ? '收起' : '展开'}
            </button>
          )}
        </div>

        {/* 关键词标签 */}
        {keywords.length > 0 && (
          <div className={styles.keywordTags}>
            {keywords.slice(0, 3).map((keyword, index) => (
              <span key={`${String(keyword)}-${index}`} className={styles.keywordTag}>
                {String(keyword)}
              </span>
            ))}
            {keywords.length > 3 && (
              <span className={styles.moreKeywords}>
                +{keywords.length - 3}
              </span>
            )}
          </div>
        )}

        {/* 展开指示器 */}
        <div className={styles.expandIndicator}>
          <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none"
            className={isExpanded ? styles.expanded : ''}
          >
            <polyline points="6,9 12,15 18,9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && (
        <div className={styles.confirmOverlay} onClick={cancelDelete}>
          <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.confirmIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" strokeWidth="2"/>
                <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </div>
            <h3 className={styles.confirmTitle}>删除笔记</h3>
            <p className={styles.confirmMessage}>
              确定要删除这条笔记吗？删除后无法恢复。
            </p>
            <div className={styles.confirmButtons}>
              <button 
                className={styles.cancelButton}
                onClick={cancelDelete}
              >
                取消
              </button>
              <button 
                className={styles.deleteConfirmButton}
                onClick={confirmDelete}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// 空状态组件
export const EmptyState: React.FC = () => {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points="10,9 9,9 8,9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h3 className={styles.emptyTitle}>还没有笔记</h3>
      <p className={styles.emptyDescription}>
        开始记录你的想法和灵感吧！<br />
        在上方的输入框中写下你的第一条笔记。
      </p>
    </div>
  );
};

export default ModernNoteCard;