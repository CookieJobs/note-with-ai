import React, { useState } from 'react';
import styles from './RelatedNoteCard.module.scss';

interface RelatedNote {
  _id: string;
  title?: string;
  content: string;
  keywords?: string[];
  createdAt: string;
  similarity: number;
}

interface RelatedNoteCardProps {
  note: RelatedNote;
  onExpand?: (noteId: string) => void;
}

export const RelatedNoteCard: React.FC<RelatedNoteCardProps> = ({ 
  note, 
  onExpand 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
    if (onExpand) {
      onExpand(note._id);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) return '昨天';
    if (diffDays <= 7) return `${diffDays}天前`;
    if (diffDays <= 30) return `${Math.ceil(diffDays / 7)}周前`;
    if (diffDays <= 365) return `${Math.ceil(diffDays / 30)}个月前`;
    return `${Math.ceil(diffDays / 365)}年前`;
  };

  const getSimilarityColor = (similarity: number) => {
    if (similarity >= 0.9) return '#10b981'; // 绿色 - 高相关
    if (similarity >= 0.8) return '#3b82f6'; // 蓝色 - 中高相关
    if (similarity >= 0.7) return '#f59e0b'; // 橙色 - 中等相关
    return '#6b7280'; // 灰色 - 低相关
  };

  const getSimilarityLabel = (similarity: number) => {
    if (similarity >= 0.9) return '高度相关';
    if (similarity >= 0.8) return '相关';
    if (similarity >= 0.7) return '可能相关';
    return '弱相关';
  };

  const truncateContent = (content: string, maxLength: number = 120) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  return (
    <div className={styles.relatedNoteCard}>
      {/* 相关性指示器 */}
      <div className={styles.similarityBadge}>
        <div 
          className={styles.similarityDot}
          style={{ backgroundColor: getSimilarityColor(note.similarity) }}
        />
        <span className={styles.similarityText}>
          {getSimilarityLabel(note.similarity)}
        </span>
        <span className={styles.similarityScore}>
          {Math.round(note.similarity * 100)}%
        </span>
      </div>

      {/* 笔记内容 */}
      <div className={styles.noteContent}>
        {note.title && (
          <h4 className={styles.noteTitle}>
            📝 {note.title}
          </h4>
        )}
        
        <p className={styles.noteText}>
          {isExpanded ? note.content : truncateContent(note.content)}
        </p>

        {note.content.length > 120 && (
          <button 
            className={styles.expandButton}
            onClick={handleToggleExpand}
          >
            {isExpanded ? '收起' : '展开'}
            <span className={`${styles.expandIcon} ${isExpanded ? styles.expanded : ''}`}>
              ▼
            </span>
          </button>
        )}
      </div>

      {/* 关键词标签 */}
      {note.keywords && note.keywords.length > 0 && (
        <div className={styles.keywords}>
          {note.keywords.slice(0, 3).map((keyword, index) => (
            <span key={index} className={styles.keyword}>
              #{keyword}
            </span>
          ))}
          {note.keywords.length > 3 && (
            <span className={styles.keywordMore}>
              +{note.keywords.length - 3}
            </span>
          )}
        </div>
      )}

      {/* 时间信息 */}
      <div className={styles.noteFooter}>
        <span className={styles.noteDate}>
          🕒 {formatDate(note.createdAt)}
        </span>
        <span className={styles.noteSource}>
          来自笔记
        </span>
      </div>
    </div>
  );
};

export default RelatedNoteCard;