/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
// import Sidebar from '../../components/Sidebar';
// import MobileMenuButton from '../../components/MobileMenuButton';
import styles from './notes.module.scss';
import { isAuthenticated, getUser, authFetch } from '../../utils/auth';
import { generateUUID } from '../../utils/uuid';
import TopNavigation from '../../components/TopNavigation';
import TrashIcon from '../../components/icons/TrashIcon';
import RelatedNoteCard, { RelatedNote } from '../../components/RelatedNoteCard';

export const dynamic = 'force-dynamic';

interface Note {
  _id: string;
  title: string;
  content: string;
  keywords: string[];
  createdAt: string;
  updatedAt?: string;
  enriching?: boolean;
}

// 现代化的笔记卡片组件
interface NoteCardProps {
  note: Note;
  onRequestDelete: (id: string) => void;
  isHighlighted?: boolean;
  onUpdateTitle: (id: string, newTitle: string) => void;
  onUpdateContent?: (id: string, newContent: string, updatedAt?: string) => void;
  onUpdateKeywords?: (id: string, newKeywords: string[], updatedAt?: string) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
}

const ModernNoteCard = ({ note, onRequestDelete, isHighlighted, onUpdateTitle, onUpdateContent, onUpdateKeywords, cardRef }: NoteCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(note.title || '');
  const [titleInputRef, setTitleInputRef] = useState<HTMLInputElement | null>(null);
  // 正文编辑相关
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editContent, setEditContent] = useState(note.content || '');
  const [originalContent, setOriginalContent] = useState(note.content || '');
  const [contentSaving, setContentSaving] = useState(false);
  const [contentError, setContentError] = useState('');
  const saveTimerRef = useRef<number | null>(null);
  // 关键词编辑相关
  const [isEditingKeywords, setIsEditingKeywords] = useState(false);
  const [editKeywords, setEditKeywords] = useState<string>((note.keywords || []).join(','));
  const [keywordsSaving, setKeywordsSaving] = useState(false);
  const [keywordsError, setKeywordsError] = useState('');
  const savingKeywordsRef = useRef<boolean>(false);
  const [keywordsSaved, setKeywordsSaved] = useState(false);
  const keywordsSavedTimerRef = useRef<number | null>(null);
  // 单标签编辑
  const [activeKeywordIndex, setActiveKeywordIndex] = useState<number | null>(null);
  const [tagEditValue, setTagEditValue] = useState<string>('');
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

  // 保存正文（防抖）
  const saveContent = async (val: string, exitAfterSuccess: boolean = false) => {
    if (!onUpdateContent) return;
    if (val.trim() === note.content) {
      if (exitAfterSuccess) setIsEditingContent(false);
      return;
    }
    setContentSaving(true);
    setContentError('');
    try {
      const response = await authFetch(`/api/notes/${note._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: val, updatedAt: note.updatedAt }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          const serverNote = data?.data?.note;
          if (serverNote?.content) {
            onUpdateContent(note._id, serverNote.content, serverNote.updatedAt);
            setEditContent(serverNote.content);
          }
          setContentError('检测到他处更新，已同步最新内容');
        } else {
          throw new Error(data?.error || '保存失败');
        }
      } else {
        const updated = data?.data?.note || {};
        onUpdateContent(note._id, updated.content || val, updated.updatedAt);
        // 异步触发 embedding 更新
        authFetch(`/api/notes/${note._id}/embed`, { method: 'POST' }).catch(() => {});
        if (exitAfterSuccess) setIsEditingContent(false);
      }
    } catch (e: any) {
      setContentError(e?.message || '保存失败');
    } finally {
      setContentSaving(false);
    }
  };

  const scheduleSaveContent = (val: string) => {};

  const cancelEditContent = () => {
    setEditContent(note.content || '');
    setIsEditingContent(false);
    setContentError('');
  };

  // 保存关键词
  const saveKeywords = async (val: string) => {
    if (!onUpdateKeywords) return;
    if (savingKeywordsRef.current) return;
    const arr = val.split(',').map(s => s.trim()).filter(Boolean);
    setKeywordsSaving(true);
    setKeywordsError('');
    setKeywordsSaved(false);
    savingKeywordsRef.current = true;
    try {
      const response = await authFetch(`/api/notes/${note._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: arr, updatedAt: note.updatedAt }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          const serverNote = data?.data?.note;
          if (Array.isArray(serverNote?.keywords)) {
            onUpdateKeywords(note._id, serverNote.keywords, serverNote.updatedAt);
            setEditKeywords(serverNote.keywords.join(','));
          }
          setKeywordsError('检测到他处更新，已同步最新关键词');
        } else {
          throw new Error(data?.error || '保存失败');
        }
      } else {
        const updated = data?.data?.note || {};
        onUpdateKeywords(note._id, updated.keywords || arr, updated.updatedAt);
        // 成功后退出编辑模式
        setIsEditingKeywords(false);
      }
    } catch (e: any) {
      setKeywordsError(e?.message || '保存失败');
    } finally {
      setKeywordsSaving(false);
      savingKeywordsRef.current = false;
    }
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
  useEffect(() => {
    setEditContent(note.content || '');
  }, [note.content]);
  useEffect(() => {
    setEditKeywords((note.keywords || []).join(','));
  }, [note.keywords]);
  
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
            {note.enriching && (!note.title || note.title.trim().length === 0) ? (
              <div className={styles.titleSkeleton} />
            ) : (
              note.title || '点击添加标题'
            )}
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
                onRequestDelete(note._id);
              }}>
            <TrashIcon />
          </button>
        </div>
      </div>
      
      <div className={styles.noteContent}>
        <div
          ref={wrapperRef}
          className={isEditingContent ? styles.noteTextWrapperEditing : styles.noteTextWrapper}
          style={{ maxHeight: isEditingContent ? undefined : maxHeight }}
        >
          {isEditingContent ? (
            <textarea
              className={styles.noteContentInput}
              value={editContent}
              onChange={(e) => {
                const v = e.target.value;
                setEditContent(v);
              }}
              rows={Math.min(12, Math.max(6, Math.ceil(editContent.length / 80)))}
            />
          ) : (
            <p
              ref={textRef}
              className={styles.noteText}
              onDoubleClick={() => { setOriginalContent(note.content || ''); setEditContent(note.content || ''); setIsEditingContent(true); }}
            >{note.content}</p>
          )}
        </div>
        {!isEditingContent && canExpand && (
          <div className={`${styles.fadeOverlay} ${!isExpanded ? styles.fadeOverlayVisible : ''}`} />
        )}
        <div className={styles.noteEditBar}>
          {isEditingContent && (
            <div className={styles.noteEditActions}>
              <button
                type="button"
                className={styles.noteEditCancel}
                onClick={() => { setEditContent(originalContent || ''); setIsEditingContent(false); setContentError(''); }}
                disabled={contentSaving}
              >取消</button>
              <button
                type="button"
                className={styles.noteEditSave}
                onClick={() => saveContent(editContent, true)}
                disabled={contentSaving}
              >保存</button>
              {contentError && <span className={styles.errorInline}>{contentError}</span>}
            </div>
          )}
        </div>
        {canExpand && !isEditingContent && (
          <button
            type="button"
            className={styles.expandPill}
            onClick={() => setIsExpanded((v) => !v)}
          >
            {isExpanded ? '收起' : '展开'}
          </button>
        )}
      </div>
      
      <div className={styles.noteKeywords}>
        {note.enriching && (!(note.keywords && note.keywords.length)) ? (
          <>
            <span className={styles.chipSkeleton} />
            <span className={styles.chipSkeleton} />
            <span className={styles.chipSkeleton} />
          </>
        ) : (
          <>
            {(note.keywords && note.keywords.length > 0) ? (
              (note.keywords || []).map((kw, idx) => (
                activeKeywordIndex === idx ? (
                  <input
                    key={idx}
                    className={styles.keywordEditInput}
                    value={tagEditValue}
                    autoFocus
                    onChange={(e) => setTagEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const arr = [...(note.keywords || [])];
                        const v = tagEditValue.trim();
                        if (v) arr[idx] = v; else arr.splice(idx, 1);
                        authFetch(`/api/notes/${note._id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ keywords: arr, updatedAt: note.updatedAt }),
                        })
                        .then(r => r.json())
                        .then(data => {
                          const updated = data?.data?.note;
                          const next = Array.isArray(updated?.keywords) ? updated.keywords : arr;
                          onUpdateKeywords && onUpdateKeywords(note._id, next, updated?.updatedAt);
                          setActiveKeywordIndex(null);
                          setTagEditValue('');
                        })
                        .catch(() => { setActiveKeywordIndex(null); setTagEditValue(''); });
                      } else if (e.key === 'Escape') {
                        setActiveKeywordIndex(null);
                        setTagEditValue('');
                      }
                    }}
                    onBlur={() => {
                      const arr = [...(note.keywords || [])];
                      const v = tagEditValue.trim();
                      if (v) arr[idx] = v; else arr.splice(idx, 1);
                      authFetch(`/api/notes/${note._id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ keywords: arr, updatedAt: note.updatedAt }),
                      })
                      .then(r => r.json())
                      .then(data => {
                        const updated = data?.data?.note;
                        const next = Array.isArray(updated?.keywords) ? updated.keywords : arr;
                        onUpdateKeywords && onUpdateKeywords(note._id, next, updated?.updatedAt);
                      })
                      .finally(() => { setActiveKeywordIndex(null); setTagEditValue(''); });
                    }}
                  />
                ) : (
                  <span
                    key={idx}
                    className={styles.keyword}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setActiveKeywordIndex(idx); setTagEditValue(kw); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setActiveKeywordIndex(idx); setTagEditValue(kw); } }}
                  >{kw}</span>
                )
              ))
            ) : (
              <span
                className={styles.keyword}
                role="button"
                tabIndex={0}
                onClick={() => { setActiveKeywordIndex(0); setTagEditValue(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { setActiveKeywordIndex(0); setTagEditValue(''); } }}
              >点击添加关键词</span>
            )}
          </>
        )}
      </div>
    

    </div>
  );
};

function NotesContent() {
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
  // 新增：滚动容器 ref 与收缩状态
  const notesScrollRef = useRef<HTMLDivElement | null>(null);
  const [composeCollapsed, setComposeCollapsed] = useState(false);
  
  // 相关笔记状态
  const [activeRelatedNoteId, setActiveRelatedNoteId] = useState<string | null>(null);
  const [relatedNotes, setRelatedNotes] = useState<RelatedNote[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [noRelatedFound, setNoRelatedFound] = useState(false);

  // 删除确认弹窗：提升到页面级，避免被单条卡片的 transform/overflow 影响层级
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!composeCollapsed) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    } else {
      el.style.height = '';
    }
  }, [newContent, composeCollapsed]);

  // 更新笔记标题
  const handleUpdateTitle = (id: string, newTitle: string) => {
    setNotes(prevNotes => 
      prevNotes.map(note => 
        note._id === id ? { ...note, title: newTitle } : note
      )
    );
  };

  const handleUpdateContent = (id: string, newContent: string, updatedAt?: string) => {
    setNotes(prevNotes => 
      prevNotes.map(note => 
        note._id === id ? { ...note, content: newContent, updatedAt: updatedAt || note.updatedAt } : note
      )
    );
  };

  const handleUpdateKeywords = (id: string, newKeywords: string[], updatedAt?: string) => {
    setNotes(prevNotes => 
      prevNotes.map(note => 
        note._id === id ? { ...note, keywords: newKeywords, updatedAt: updatedAt || note.updatedAt } : note
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

    setIsComposing(false);
    hideTimerRef.current = window.setTimeout(() => {
      setActionsA11yHidden(true);
    }, 120);
  }, [setActionsA11yHidden]);

  // 初始时默认隐藏 actions（未激活）
  useEffect(() => {
    setActionsA11yHidden(true);
  }, [setActionsA11yHidden]);

  // 监听列表滚动以控制“快速记录”收缩态
  useEffect(() => {
    const scroller = notesScrollRef.current;
    if (!scroller) return;
    let ticking = false;
    const threshold = 80;
    const update = () => {
      const collapsed = scroller.scrollTop > threshold && !isComposing;
      setComposeCollapsed(collapsed);
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    scroller.addEventListener('scroll', onScroll);
    // 初始化一次
    setComposeCollapsed(scroller.scrollTop > threshold && !isComposing);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [isComposing]);
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
    // 乐观插入临时笔记并标记富化中
    const tempId = 'temp-' + generateUUID();
    const tempNote: Note = {
      _id: tempId,
      title: '',
      content,
      keywords: [],
      createdAt: new Date().toISOString(),
      enriching: true,
    };
    setNotes(prev => [tempNote, ...prev]);
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
      const created: Note | undefined = (data?.success && data?.data) ? data.data : data;
      if (created && created._id) {
        setNotes(prev => prev.map(n => n._id === tempId ? { ...created, enriching: true } as Note : n));
        setNewContent('');
        setIsComposing(false);

        // 获取相关笔记
        setActiveRelatedNoteId(created._id);
        setRelatedNotes([]);
        setNoRelatedFound(false);
        setRelatedLoading(true);

        // 1. 异步生成 embedding，不阻塞相关笔记查询（因为查询用的是文本）
        authFetch(`/api/notes/${created._id}/embed`, { method: 'POST' }).catch(console.error);

        // 1.5 异步生成标题与关键词（内容不变也触发）
        authFetch(`/api/notes/${created._id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: created.content, autoSummarize: true })
        })
        .then(r => r.json())
        .then(patchData => {
          const updated = patchData?.data?.note;
          if (updated && updated._id === created._id) {
            setNotes(prev => prev.map(n => n._id === created._id ? {
              ...n,
              title: typeof updated.title === 'string' ? updated.title : n.title,
              keywords: Array.isArray(updated.keywords) ? updated.keywords : n.keywords,
              enriching: false,
              updatedAt: updated.updatedAt || n.updatedAt,
            } : n));
          } else {
            setNotes(prev => prev.map(n => n._id === created._id ? { ...n, enriching: false } : n));
          }
        })
        .catch(() => {
          setNotes(prev => prev.map(n => n._id === created._id ? { ...n, enriching: false } : n));
        });

        // 2. 查询相关笔记
        authFetch('/api/chat/related-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            message: created.content, 
            excludeNoteId: created._id,
            limit: 3,
            threshold: 0.3 // 显式降低阈值
          }),
        })
        .then(res => res.json())
        .then(relatedData => {
           if (relatedData.success && Array.isArray(relatedData.data?.relatedNotes)) {
             const list = relatedData.data.relatedNotes;
             if (list.length > 0) {
               // 转换后端返回的数据结构以匹配 RelatedNote 接口
               const formattedNotes = list.map((item: any) => ({
                 ...item.note,
                 similarity: item.score
               }));
               setRelatedNotes(formattedNotes);
             } else {
               setNoRelatedFound(true);
               // 3秒后自动隐藏区域
               setTimeout(() => {
                 setActiveRelatedNoteId(null);
                 setNoRelatedFound(false);
               }, 3000);
             }
           } else {
             setNoRelatedFound(true);
             setTimeout(() => { setActiveRelatedNoteId(null); setNoRelatedFound(false); }, 3000);
           }
        })
        .catch(err => {
          console.error('获取相关笔记失败:', err);
          setNoRelatedFound(true);
          setTimeout(() => { setActiveRelatedNoteId(null); setNoRelatedFound(false); }, 3000);
        })
        .finally(() => setRelatedLoading(false));

        // 聚焦输入框，便于继续记录
        requestAnimationFrame(() => textareaRef.current?.focus());
      } else {
        console.warn('未知的创建返回结构:', data);
      }
    } catch (err: any) {
      console.error('创建笔记失败:', err);
      setError(err?.message || '创建笔记失败，请稍后重试');
      // 回滚临时笔记
      setNotes(prev => prev.filter(n => n._id !== tempId));
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
            className={`${styles.composeArea} ${isComposing ? styles.composing : ''} ${composeCollapsed ? styles.composeAreaCollapsed : ''}`}
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
              onFocus={() => { setIsComposing(true); setComposeCollapsed(false); }}
              onKeyDown={handleKeyDown}
              rows={composeCollapsed ? 1 : 3}
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
                    onClick={() => { setIsComposing(false); setNewContent(''); const st = notesScrollRef.current?.scrollTop || 0; setComposeCollapsed(st > 80); }}
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
            <div className={styles.notesScrollContainer} ref={notesScrollRef}>
              <div className={styles.notesList}>
                {notes.map((note) => (
                  <div key={note._id} id={`note-${note._id}`} className={styles.noteItemWrapper}>
                    <ModernNoteCard
                      note={note}
                      onRequestDelete={setPendingDeleteNoteId}
                      onUpdateTitle={handleUpdateTitle}
                      onUpdateContent={handleUpdateContent}
                      onUpdateKeywords={handleUpdateKeywords}
                      isHighlighted={!!highlightId && note._id === highlightId}
                      cardRef={attachRefIfHighlighted(note._id)}
                    />
                    {note._id === activeRelatedNoteId && (relatedNotes.length > 0 || relatedLoading || noRelatedFound) && (
                      <div className={styles.relatedNotesSection}>
                        <div className={styles.relatedHeader}>
                          <span className={styles.relatedIcon}>🔗</span>
                          <span className={styles.relatedTitle}>相关笔记</span>
                          {relatedLoading && <span className={styles.relatedLoading}>查找中...</span>}
                        </div>
                        <div className={styles.relatedList}>
                          {!relatedLoading && relatedNotes.length > 0 && relatedNotes.map(rn => (
                            <RelatedNoteCard 
                              key={rn._id} 
                              note={rn} 
                              onExpand={(id) => {
                                const el = document.getElementById(`note-${id}`);
                                if (el) {
                                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  // 添加高亮动画
                                  el.classList.add(styles.noteCardHighlight);
                                  setTimeout(() => el.classList.remove(styles.noteCardHighlight), 2000);
                                }
                              }}
                            />
                          ))}
                          {!relatedLoading && noRelatedFound && (
                            <div className={styles.emptyRelated}>
                              未找到相关笔记
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 删除确认弹窗（页面级） */}
          {pendingDeleteNoteId && (
            <div className={styles.confirmDialog} onClick={() => setPendingDeleteNoteId(null)}>
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
                    onClick={() => setPendingDeleteNoteId(null)}
                  >
                    取消
                  </button>
                  <button
                    className={styles.confirmButton}
                    onClick={async () => {
                      const id = pendingDeleteNoteId;
                      if (!id) return;
                      await handleDelete(id);
                      setPendingDeleteNoteId(null);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function NotesPage() {
  return (
    <Suspense fallback={<div>Loading notes...</div>}>
      <NotesContent />
    </Suspense>
  );
}
