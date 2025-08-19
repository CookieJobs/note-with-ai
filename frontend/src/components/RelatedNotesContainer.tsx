import React, { useState, useEffect } from 'react';
import RelatedNoteCard from './RelatedNoteCard';
import styles from './RelatedNotesContainer.module.scss';

interface RelatedNote {
  _id: string;
  title?: string;
  content: string;
  keywords?: string[];
  createdAt: string;
  similarity: number;
}

interface RelatedNotesContainerProps {
  message: string;
  isVisible?: boolean;
  className?: string;
}

export const RelatedNotesContainer: React.FC<RelatedNotesContainerProps> = ({
  message,
  isVisible = true,
  className = ''
}) => {
  const [relatedNotes, setRelatedNotes] = useState<RelatedNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (message && message.trim().length > 10) {
      fetchRelatedNotes(message);
    }
  }, [message]);

  const fetchRelatedNotes = async (queryMessage: string) => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('用户未登录');
      }

      const response = await fetch('/api/chat/related-notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: queryMessage,
          threshold: 0.7,
          limit: 3
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success) {
        setRelatedNotes(data.data.relatedNotes || []);
      } else {
        throw new Error(data.message || '获取相关笔记失败');
      }
    } catch (err: any) {
      console.error('获取相关笔记失败:', err);
      setError(err.message || '获取相关笔记失败');
      setRelatedNotes([]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleNoteExpand = (noteId: string) => {
    console.log('展开笔记:', noteId);
    // 这里可以添加笔记展开的逻辑，比如跳转到笔记详情页
  };

  if (!isVisible || (!loading && relatedNotes.length === 0 && !error)) {
    return null;
  }

  return (
    <div className={`${styles.relatedNotesContainer} ${className}`}>
      {/* 标题栏 */}
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <span className={styles.icon}>🔗</span>
          <h3 className={styles.title}>相关笔记</h3>
          {relatedNotes.length > 0 && (
            <span className={styles.count}>({relatedNotes.length})</span>
          )}
        </div>
        
        {relatedNotes.length > 0 && (
          <button 
            className={styles.collapseButton}
            onClick={handleToggleCollapse}
            aria-label={isCollapsed ? '展开' : '收起'}
          >
            <span className={`${styles.collapseIcon} ${isCollapsed ? styles.collapsed : ''}`}>
              ▼
            </span>
          </button>
        )}
      </div>

      {/* 内容区域 */}
      <div className={`${styles.content} ${isCollapsed ? styles.collapsed : ''}`}>
        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
            <span>正在查找相关笔记...</span>
          </div>
        )}

        {error && (
          <div className={styles.error}>
            <span className={styles.errorIcon}>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && relatedNotes.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>📝</span>
            <span>暂无相关笔记</span>
          </div>
        )}

        {!loading && relatedNotes.length > 0 && (
          <div className={styles.notesList}>
            {relatedNotes.map((note) => (
              <RelatedNoteCard
                key={note._id}
                note={note}
                onExpand={handleNoteExpand}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      {!loading && relatedNotes.length > 0 && !isCollapsed && (
        <div className={styles.footer}>
          <span className={styles.footerText}>
            💡 这些笔记可能与当前对话相关
          </span>
        </div>
      )}
    </div>
  );
};

export default RelatedNotesContainer;