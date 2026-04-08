/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
import React, { useState } from 'react';
import styles from './RelatedNoteCard.module.scss';

export interface RelatedNote {
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
    if (onExpand && note?._id) {
      onExpand(note._id);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    
    // 计算本周一的凌晨 00:00:00
    const currentDay = now.getDay(); // 0 是周日, 1-6 是周一到周六
    const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - distanceToMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    
    // 计算下周一的凌晨 00:00:00
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    
    const pad = (n: number) => n.toString().padStart(2, '0');
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    const timeStr = `${hh}:${mm}:${ss}`;
    
    if (date >= startOfWeek && date < endOfWeek) {
      const days = ['日', '一', '二', '三', '四', '五', '六'];
      const dayStr = days[date.getDay()];
      return `本周${dayStr} ${timeStr}`;
    } else {
      const yyyy = date.getFullYear();
      const month = pad(date.getMonth() + 1);
      const dd = pad(date.getDate());
      return `${yyyy}-${month}-${dd} ${timeStr}`;
    }
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

  const truncateContent = (content?: string, maxLength: number = 120) => {
    const text = content || '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const contentText = note?.content || '';
  const keywords = Array.isArray(note?.keywords) ? note.keywords.filter(Boolean) : [];

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
          {isExpanded ? contentText : truncateContent(contentText)}
        </p>

        {contentText.length > 120 && (
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
      {keywords.length > 0 && (
        <div className={styles.keywords}>
          {keywords.slice(0, 3).map((keyword, index) => (
            <span key={`${String(keyword)}-${index}`} className={styles.keyword}>
              #{String(keyword)}
            </span>
          ))}
          {keywords.length > 3 && (
            <span className={styles.keywordMore}>
              +{keywords.length - 3}
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