'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
// import Sidebar from '../../components/Sidebar';
// import MobileMenuButton from '../../components/MobileMenuButton';
import styles from './notes.module.scss';
import { isAuthenticated, getUser, authFetch } from '../../utils/auth';
import TopNavigation from '../../components/TopNavigation';

interface Note {
  _id: string;
  title: string;
  content: string;
  keywords: string[];
  createdAt: string;
}

// 现代化的笔记卡片组件
interface NoteCardProps {
  note: Note;
  onDelete: (id: string) => void;
}

const ModernNoteCard = ({ note, onDelete }: NoteCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return '今天';
    if (diffDays === 2) return '昨天';
    if (diffDays <= 7) return `${diffDays - 1} 天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const truncateContent = (content: string, maxLength: number = 150) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  return (
    <>
      <div className={styles.noteCard} onClick={() => setIsExpanded(!isExpanded)}>
        <div className={styles.noteHeader}>
          <div className={styles.noteTitle}>{note.title}</div>
          <div className={styles.noteActions}>
            <span className={styles.noteDate}>{formatDate(note.createdAt)}</span>
            <button
              className={styles.deleteButton}
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}
              aria-label="删除笔记"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
        
        <div className={styles.noteContent}>
          {isExpanded ? note.content : truncateContent(note.content)}
        </div>
        
        {note.keywords && note.keywords.length > 0 && (
          <div className={styles.noteKeywords}>
            {(showAllKeywords ? note.keywords : note.keywords.slice(0, 3)).map((keyword, index) => (
              <span key={index} className={styles.keyword}>
                {keyword}
              </span>
            ))}
            {note.keywords.length > 3 && (
              <span 
                className={styles.keywordMore}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAllKeywords(!showAllKeywords);
                }}
              >
                {showAllKeywords ? '收起' : `+${note.keywords.length - 3}`}
              </span>
            )}
          </div>
        )}
        
        {note.content.length > 150 && (
          <div className={styles.expandIndicator}>
            {isExpanded ? '收起' : '展开'}
          </div>
        )}
      </div>

      {showDeleteConfirm && (
        <div className={styles.confirmDialog} onClick={() => setShowDeleteConfirm(false)}>
          <div className={styles.confirmDialogContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.confirmIcon}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="2"/>
                <path d="M15 9l-6 6M9 9l6 6" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 className={styles.confirmTitle}>删除笔记</h3>
            <p className={styles.confirmMessage}>确定要删除这条笔记吗？此操作无法撤销。</p>
            <div className={styles.confirmActions}>
              <button 
                className={styles.cancelButton} 
                onClick={() => setShowDeleteConfirm(false)}
              >
                取消
              </button>
              <button 
                className={styles.confirmButton} 
                onClick={() => {
                  onDelete(note._id);
                  setShowDeleteConfirm(false);
                }}
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
const EmptyState = () => (
  <div className={styles.emptyState}>
    <div className={styles.emptyIcon}>
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <polyline points="10,9 9,9 8,9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
    <h3 className={styles.emptyTitle}>还没有笔记</h3>
    <p className={styles.emptyDescription}>开始记录你的想法和灵感吧</p>
  </div>
);

export default function NotesPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newContent, setNewContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 检查用户认证状态
  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/auth');
      return;
    }
    
    const userData = getUser();
    if (userData) {
      setUser(userData);
    } else {
      router.push('/auth');
    }
  }, [router]);

  // 加载笔记
  useEffect(() => {
    if (!user) return;
    
    authFetch('/api/notes')
      .then((res) => {
        if (!res.ok) throw new Error(`请求失败: ${res.status}`);
        return res.json();
      })
      .then((response) => {
        console.log('📝 /api/notes 返回内容:', response);

        // 后端返回格式: {success: true, message: string, data: {notes: Note[]}}
        if (response.success && response.data && Array.isArray(response.data.notes)) {
          setNotes(response.data.notes);
        } else {
          console.warn('⚠️ /api/notes 返回格式错误:', response);
          setNotes([]);
        }
      })
      .catch((err) => {
        console.error('加载失败:', err);
        setError('加载失败，请稍后重试');
      });
  }, [user]);

  const handleSubmit = async () => {
    if (!newContent.trim()) return;

    setLoading(true);
    setError('');

    try {
      const res = await authFetch('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ content: newContent }),
      });

      if (!res.ok) throw new Error(`提交失败: ${res.status}`);
      const newNote = await res.json();

      setNotes((prev) => [newNote, ...prev]);
      setNewContent('');
      setIsComposing(false);
      
      // 重置文本框高度
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err) {
      console.error(err);
      setError('提交失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await authFetch(`/api/notes/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('删除失败');
      setNotes((prev) => prev.filter((note) => note._id !== id));
    } catch (err) {
      console.error('删除失败:', err);
      setError('删除失败，请稍后重试');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  if (!user) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingSpinner}></div>
        <p>正在验证身份...</p>
      </div>
    );
  }

  return (
    // 顶部导航布局容器
    <div className={styles.container}>
      <TopNavigation />
      <main className={styles.mainContent}>
        {/* 移除内部 topBar，避免重复展示用户区 */}
        {/* <header className={styles.topBar}> */}
        {/*   <div className={styles.titleSection}> */}
        {/*     <h1 className={styles.pageTitle}>Notes</h1> */}
        {/*     <span className={styles.noteCount}>{notes.length} 条笔记</span> */}
        {/*   </div> */}
        {/*   <div className={styles.userSection}> */}
        {/*     <div className={styles.userAvatar}> */}
        {/*       {user.username.charAt(0).toUpperCase()} */}
        {/*     </div> */}
        {/*     <div className={styles.userInfo}> */}
        {/*       <span className={styles.userName}>{user.username}</span> */}
        {/*       <button onClick={logout} className={styles.logoutButton}> */}
        {/*         <svg width="16" height="16" viewBox="0 0 24 24" fill="none"> */}
        {/*           <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/> */}
        {/*         </svg> */}
        {/*         退出 */}
        {/*       </button> */}
        {/*     </div> */}
        {/*   </div> */}
        {/* </header> */}

        {/* 写作区域 - 紧贴topbar */}
        <div className={`${styles.composeArea} ${isComposing ? styles.composing : ''}`}>
          <div className={styles.composeHeader}>
            <div className={styles.composeIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className={styles.composeTitle}>记录新想法</span>
          </div>
          
          <textarea
            ref={textareaRef}
            className={styles.composeInput}
            placeholder="有什么想法要记录吗？支持 Cmd/Ctrl + Enter 快速提交"
            value={newContent}
            onFocus={() => setIsComposing(true)}
            onBlur={() => !newContent.trim() && setIsComposing(false)}
            onChange={(e) => {
              setNewContent(e.target.value);
              adjustTextareaHeight();
            }}
            onKeyDown={handleKeyDown}
          />
          
          {(isComposing || newContent.trim()) && (
            <div className={styles.composeActions}>
              <div className={styles.composeHint}>
                <kbd>⌘</kbd> + <kbd>Enter</kbd> 快速提交
              </div>
              <div className={styles.composeButtons}>
                <button
                  className={styles.cancelButton}
                  onClick={() => {
                    setNewContent('');
                    setIsComposing(false);
                    if (textareaRef.current) {
                      textareaRef.current.style.height = 'auto';
                    }
                  }}
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || !newContent.trim()}
                  className={styles.submitButton}
                >
                  {loading ? (
                    <div className={styles.buttonSpinner}></div>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <line x1="22" y1="2" x2="11" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <polygon points="22,2 15,22 11,13 2,9 22,2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      发布
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className={styles.errorBanner}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" strokeWidth="2"/>
              <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" strokeWidth="2"/>
            </svg>
            {error}
          </div>
        )}

        <div className={styles.contentWrapper}>
          {/* 笔记列表 */}
          <div className={styles.notesScrollContainer}>
            <div className={styles.notesContainer}>
              {notes.length === 0 ? (
                <EmptyState />
              ) : (
                <div className={styles.notesList}>
                  {notes.map((note) => (
                    <ModernNoteCard
                      key={note._id}
                      note={note}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
