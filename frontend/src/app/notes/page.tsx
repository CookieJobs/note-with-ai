'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
// import Sidebar from '../../components/Sidebar';
// import MobileMenuButton from '../../components/MobileMenuButton';
import styles from './notes.module.scss';
import { isAuthenticated, getUser, authFetch } from '../../utils/auth';
import TopNavigation from '../../components/TopNavigation';
import TrashIcon from '../../components/icons/TrashIcon';

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
  isHighlighted?: boolean;
  onUpdateTitle: (id: string, newTitle: string) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
}

const ModernNoteCard = ({ note, onDelete, isHighlighted, onUpdateTitle, cardRef }: NoteCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(note.title || '');
  const [titleInputRef, setTitleInputRef] = useState<HTMLInputElement | null>(null);
  // 正文引用与可展开判定
  const textRef = useRef<HTMLParagraphElement>(null);
  const [canExpand, setCanExpand] = useState(false);
  // 包裹容器用于高度动画
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<string>('');

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

  // 保存标题修改
  const saveTitle = async () => {
    console.log("进入save")
    if (editTitle.trim() !== note.title) {
      try {
        note.title = editTitle.trim();
        console.log('准备保存标题:', editTitle.trim());
        // 调用API保存新标题
        const response = await authFetch(`/api/notes/${note._id}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: note.title }),
        });
        
        if (!response.ok) {
          throw new Error('保存标题失败');
        }
        
        const data = await response.json();
        
        onUpdateTitle(note._id, note.title);
        
        console.log('标题保存成功:', data.data.note.title);
      } catch (error) {
        console.error('保存标题失败:', error);
        // 可以添加错误提示给用户
        setEditTitle(note.title || ''); // 恢复原标题
      }
    }
    setIsEditingTitle(false);
  };

  // 取消编辑标题
  const cancelEditTitle = () => {
    setEditTitle(note.title || '');
    setIsEditingTitle(false);
  };

  // 处理标题输入框的键盘事件
  const handleTitleKeyPress = (e: React.KeyboardEvent) => {
    console.log('键盘事件:', e.key);
    if (e.key === 'Enter') {
      saveTitle();
    } else if (e.key === 'Escape') {
      cancelEditTitle();
    }
  };
  
  // 当进入编辑模式时，自动聚焦输入框
  useEffect(() => {
    if (isEditingTitle) {
      requestAnimationFrame(() => {
        titleInputRef?.focus();
        titleInputRef?.select();
      });
    }
  }, [isEditingTitle]);

  // 同步 note.title 到 editTitle
  useEffect(() => {
    setEditTitle(note.title || '');
  }, [note.title]);
  
  // 仅依据“内容的总高度”和“6行高度”判断是否可展开，避免依赖 CSS line-clamp
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const computeCollapsedH = () => {
      const computed = window.getComputedStyle(el);
      const lineHeightStr = computed.lineHeight;
      const lineHeight = parseFloat(lineHeightStr || '22');
      return Math.max(0, Math.round(lineHeight * 6));
    };

    const check = () => {
      const collapsedH = computeCollapsedH();
      const hasOverflow = el.scrollHeight - 1 > collapsedH; // 内容总高度是否超过6行
      setCanExpand(hasOverflow);
    };

    check();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => check());
      ro.observe(el);
    } else {
      window.addEventListener('resize', check);
    }

    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', check);
    };
  }, [note.content]);

  // 根据 isExpanded 平滑过渡高度
  useEffect(() => {
    const p = textRef.current;
    const wrap = wrapperRef.current;
    if (!p || !wrap) return;

    const computed = window.getComputedStyle(p);
    const lineHeightStr = computed.lineHeight;
    const lineHeight = parseFloat(lineHeightStr || '22');
    const collapsedH = Math.max(0, Math.round(lineHeight * 6)); // 6 行

    if (isExpanded) {
      // 展开：以内容完整高度为目标
      const fullH = p.scrollHeight;
      setMaxHeight(fullH + 'px');
    } else {
      // 收起：回到 6 行高度
      setMaxHeight(collapsedH + 'px');
    }
  }, [isExpanded, note.content]);

  // 组合卡片 classname，高亮时追加类名
  const cardClassName = `${styles.noteCard} ${isHighlighted ? styles.noteCardHighlight : ''}`;

  return (
    <div ref={cardRef || undefined} className={cardClassName}>
      {/* 其余渲染保持不变 */}
      <div className={styles.noteHeader} onClick={() => setIsExpanded(!isExpanded)}>
        {isEditingTitle ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <input
              autoFocus
              ref={setTitleInputRef}
              type="text"
              value={editTitle}
              onChange={(e) => {
                console.log('设置新标题:', e.target.value);
                setEditTitle(e.target.value)
              }}
              onKeyDown={handleTitleKeyPress}
              onBlur={cancelEditTitle}
              className={styles.noteTitleInput}
              placeholder="添加标题..."
              maxLength={100}
            />
            {/* <button
              onMouseDown={(e) => {
                console.log('点击确认按钮');
                e.stopPropagation();
                saveTitle();
              }}
              className={styles.noteEditTitleConfirm}
              aria-label="保存标题"
            >
              ✓
            </button> */}
          </div>
        ) : (
          <div 
            className={styles.noteTitle} 
            onClick={(e) => {
              console.log('标题被点击，进入编辑模式');
              e.stopPropagation();
              setIsEditingTitle(true);
            }}
          >
            {note.title || '点击添加标题'}
          </div>
        )} 
        <div className={styles.noteActions}>
          {isEditingTitle && (
            <button
              onMouseDown={(e) => {
                e.stopPropagation();
                saveTitle();
              }}
              className={styles.noteEditTitleConfirm}
              aria-label="保存标题"
            >
              ✓
            </button>
          )}
          <span className={styles.noteDate}>{formatDate(note.createdAt)}</span>
          <button className={styles.deleteButton} onClick={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}>
            <TrashIcon />
          </button>
        </div>
      </div>
      
      <div className={styles.noteContent}>
        <div ref={wrapperRef} className={styles.noteTextWrapper} style={{ maxHeight }}>
          <p ref={textRef} className={isExpanded ? styles.noteTextExpanded : styles.noteText}>{note.content}</p>
        </div>
        {(isExpanded || canExpand) && (
          <button
            type="button"
            className={styles.expandToggle}
            onClick={() => setIsExpanded((v) => !v)}
          >
            {isExpanded ? '收起' : '展开全文'}
          </button>
        )}
      </div>
      
      {note.keywords && note.keywords.length > 0 && (
        <div className={styles.noteKeywords}>
          {note.keywords.map((kw, idx) => (
            <span key={idx} className={styles.keyword}>{kw}</span>
          ))}
        </div>
      )}
    

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
    </div>
  );
};


export default function NotesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<any>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newContent, setNewContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // 新增：compose 区域容器与操作区 refs + 隐藏定时器
  const composeContainerRef = useRef<HTMLDivElement | null>(null);
  const composeActionsRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  // 更新笔记标题
  const handleUpdateTitle = (id: string, newTitle: string) => {
    setNotes(prevNotes => 
      prevNotes.map(note => 
        note._id === id ? { ...note, title: newTitle } : note
      )
    );
  };

  // 新增：隐藏时禁用可聚焦元素，显示时恢复（轻量可访问性增强）
  const setActionsA11yHidden = useCallback((hidden: boolean) => {
    const actions = composeActionsRef.current;
    if (!actions) return;

    actions.setAttribute('aria-hidden', hidden ? 'true' : 'false');

    const focusables = actions.querySelectorAll<HTMLElement>(
      'a[href], button, textarea, input, select, [tabindex]'
    );
    focusables.forEach((el) => {
      if (hidden) {
        const prev = el.getAttribute('tabindex');
        if (prev !== null) el.setAttribute('data-prev-tabindex', prev);
        el.setAttribute('tabindex', '-1');
      } else {
        const prev = el.getAttribute('data-prev-tabindex');
        if (prev !== null) {
          if (prev === '') el.removeAttribute('tabindex');
          else el.setAttribute('tabindex', prev);
          el.removeAttribute('data-prev-tabindex');
        } else if (el.getAttribute('tabindex') === '-1') {
          el.removeAttribute('tabindex');
        }
      }
    });
  }, []);

  // 组合区获得与失去焦点时的处理（避免从输入框切到按钮时闪烁）
  const handleComposeFocusCapture = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setActionsA11yHidden(false);
  }, [setActionsA11yHidden]);

  const handleComposeBlurCapture = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    const container = composeContainerRef.current;
    if (container && next && container.contains(next)) return; // 焦点仍在容器内

    hideTimerRef.current = window.setTimeout(() => {
      setActionsA11yHidden(true);
    }, 120);
  }, [setActionsA11yHidden]);

  // 初始时默认隐藏 actions（未激活）
  useEffect(() => {
    setActionsA11yHidden(true);
  }, [setActionsA11yHidden]);
  const highlightId = searchParams.get('highlight') || '';
  const highlightedRef = useRef<HTMLDivElement | null>(null);

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

    const controller = new AbortController();
    let mounted = true;
    
    authFetch('/api/notes', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`请求失败: ${res.status}`);
        return res.json();
      })
      .then((response) => {
        if (!mounted) return;
        console.log('📝 /api/notes 返回内容:', response);

        if (response.success && response.data && Array.isArray(response.data.notes)) {
          setNotes(response.data.notes);
        } else if (Array.isArray(response?.notes)) {
          setNotes(response.notes);
        } else {
          console.warn('⚠️ /api/notes 返回格式错误:', response);
          setNotes([]);
        }
      })
      .catch((err: any) => {
        if (err?.name === 'AbortError') return;
        console.error('加载失败:', err);
        setError('加载失败，请稍后重试');
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [user]);

  // 首次加载后滚动并高亮
  useEffect(() => {
    if (!highlightId || notes.length === 0) return;
    // 延迟到列表渲染完成
    const timer = setTimeout(() => {
      if (highlightedRef.current) {
        highlightedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [highlightId, notes]);

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

  const attachRefIfHighlighted = (id: string) => (el: HTMLDivElement | null) => {
    if (!highlightId) return;
    if (id === highlightId) {
      highlightedRef.current = el;
      // 临时添加动画类，3秒后移除高亮（通过 CSS 动画淡出）
      if (el) {
        el.classList.add(styles.noteCardHighlight);
        setTimeout(() => {
          el && el.classList.remove(styles.noteCardHighlight);
        }, 3000);
      }
    }
  };

  // 新增：提交新笔记
  const handleSubmit = async () => {
    const content = newContent.trim();
    if (!content || loading) return;
    setLoading(true);
    setError('');

    try {
      const res = await authFetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`创建失败: ${res.status} ${txt}`);
      }

      const data = await res.json();
      // 兼容不同返回结构
      const created: Note | undefined = (data?.success && data?.data) ? data.data : data;
      if (created && created._id) {
        setNotes(prev => [created, ...prev]);
        setNewContent('');
        setIsComposing(false);
        // 聚焦输入框，便于继续记录
        requestAnimationFrame(() => textareaRef.current?.focus());
      } else {
        console.warn('未知的创建返回结构:', data);
      }
    } catch (err: any) {
      console.error('创建笔记失败:', err);
      setError(err?.message || '创建笔记失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // 新增：键盘快捷键 Cmd/Ctrl + Enter 提交
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={styles.container}>
      <TopNavigation />
      <main className={styles.mainContent}>
        <div className={styles.contentWrapper}>
          {/* 错误提示 */}
          {error && (
            <div className={styles.errorBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 9v4m0 4h.01M10.29 3.86l-7.5 12.99A1 1 0 003.62 18h16.76a1 1 0 00.86-1.5l-7.5-12.99a1 1 0 00-1.72 0z" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* 写作输入区域（恢复） */}
          <div
            ref={composeContainerRef}
            className={`${styles.composeArea} ${isComposing ? styles.composing : ''}`}
            onFocusCapture={handleComposeFocusCapture}
            onBlurCapture={handleComposeBlurCapture}
          >
            <div className={styles.composeHeader}>
              <div className={styles.composeIcon}>📝</div>
              <div className={styles.composeTitle}>快速记录</div>
            </div>
            <textarea
              ref={textareaRef}
              className={styles.composeInput}
              placeholder="此刻的想法、待办或总结... 支持 Cmd/Ctrl + Enter 快速保存"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              onFocus={() => setIsComposing(true)}
              onKeyDown={handleKeyDown}
              rows={3}
              disabled={loading}
            />
            <div className={styles.composeActions} ref={composeActionsRef} aria-hidden="true">
              <div className={styles.composeHint}>
                <span>按</span>
                <kbd>Cmd</kbd>
                <span>/</span>
                <kbd>Ctrl</kbd>
                <span> + </span>
                <kbd>Enter</kbd>
                <span> 快速保存</span>
              </div>
              <div className={styles.composeButtons}>
                {isComposing && (
                  <button
                    className={styles.cancelButton}
                    onClick={() => { setIsComposing(false); setNewContent(''); }}
                    disabled={loading}
                  >
                    取消
                  </button>
                )}
                <button
                  className={styles.submitButton}
                  onClick={handleSubmit}
                  disabled={loading || newContent.trim().length === 0}
                >
                  {loading ? (
                    <span className={styles.buttonSpinner} />
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      保存
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className={styles.notesContainer}>
            <div className={styles.notesScrollContainer}>
              <div className={styles.notesList}>
                {notes.map((note) => (
                  <ModernNoteCard
                    key={note._id}
                    note={note}
                    onDelete={handleDelete}
                    onUpdateTitle={handleUpdateTitle}
                    isHighlighted={!!highlightId && note._id === highlightId}
                    cardRef={attachRefIfHighlighted(note._id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
