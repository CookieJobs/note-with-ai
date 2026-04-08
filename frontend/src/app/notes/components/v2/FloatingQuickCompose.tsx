'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from '../../notes-v2.module.scss';
import RichTextEditor from '../RichTextEditor';
import { Maximize2, Minimize2 } from 'lucide-react';
import { authFetch } from '../../../../utils/auth';
import RelatedNoteCard from '../../../../components/RelatedNoteCard';
import type { Note } from '../../hooks/useNotes';

type RelatedNote = Note & { similarity?: number };

type Props = {
  valueJson: any | null;
  valueText: string;
  onChange: (next: { json: any; text: string }) => void;
  onSubmit: () => void;
  onCancel: () => void;
  loading?: boolean;
  allNotes?: Note[];
  onSelectNote?: (id: string) => void;
};

export default function FloatingQuickCompose({
  valueJson,
  valueText,
  onChange,
  onSubmit,
  onCancel,
  loading = false,
  allNotes = [],
  onSelectNote,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [toolbarVariant, setToolbarVariant] = useState<'simple' | 'advanced'>('simple');
  const bounceTimerRef = useRef<number | null>(null);
  const [bouncing, setBouncing] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const suppressBlurRef = useRef(false);
  const expandedRef = useRef<HTMLDivElement | null>(null);
  const [suggestNotes, setSuggestNotes] = useState<RelatedNote[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const suggestTimerRef = useRef<number | null>(null);
  const suggestReqIdRef = useRef(0);

  const matchTerms = useMemo(() => {
    const raw = (valueText || '').trim().toLowerCase();
    const compact = raw.replace(/\s+/g, '');
    if (!compact) return [];
    const terms: string[] = [];
    for (let i = 0; i < compact.length - 1; i++) {
      terms.push(compact.slice(i, i + 2));
      if (i + 2 < compact.length) terms.push(compact.slice(i, i + 3));
      if (terms.length > 24) break;
    }
    const wordTerms = raw.split(/\s+/).filter((t) => t.length > 1);
    for (const t of wordTerms) {
      if (!terms.includes(t)) terms.push(t);
      if (terms.length > 30) break;
    }
    // 优先长词命中
    return terms.sort((a, b) => b.length - a.length);
  }, [valueText]);

  const findMatch = (text: string, terms: string[]) => {
    if (!text || terms.length === 0) return null;
    const lower = text.toLowerCase();
    for (const t of terms) {
      const idx = lower.indexOf(t);
      if (idx >= 0) return { start: idx, end: idx + t.length };
    }
    return null;
  };

  const renderHighlighted = (text: string, match: { start: number; end: number } | null) => {
    if (!match) return text;
    const before = text.slice(0, match.start);
    const mid = text.slice(match.start, match.end);
    const after = text.slice(match.end);
    return (
      <>
        {before}
        <span className={styles.floatingComposeSuggestMatch}>{mid}</span>
        {after}
      </>
    );
  };

  const buildSnippet = (text: string, terms: string[]) => {
    const m = findMatch(text, terms);
    if (!m) {
      const t = text.slice(0, 56);
      return { text: t, match: null, hasMore: text.length > t.length, offset: 0 };
    }
    const pad = 14;
    const start = Math.max(0, m.start - pad);
    const end = Math.min(text.length, m.end + pad);
    const prefix = start > 0 ? '......' : '';
    const suffix = end < text.length ? '......' : '';
    const snippet = `${prefix}${text.slice(start, end)}${suffix}`;
    const offset = (start > 0 ? prefix.length : 0) + (m.start - start);
    return { text: snippet, match: { start: offset, end: offset + (m.end - m.start) }, hasMore: true, offset };
  };

  const localSuggestion = useMemo(() => {
    const raw = (valueText || '').trim().toLowerCase();
    if (!raw || !allNotes.length) return [];
    const compact = raw.replace(/\s+/g, '');
    if (compact.length < 2) return [];
    const terms: string[] = [];
    // 中文友好：提取 2-gram/3-gram + 原始分词
    for (let i = 0; i < compact.length - 1; i++) {
      terms.push(compact.slice(i, i + 2));
      if (i + 2 < compact.length) terms.push(compact.slice(i, i + 3));
      if (terms.length > 18) break;
    }
    const wordTerms = raw.split(/\s+/).filter((t) => t.length > 1);
    for (const t of wordTerms) {
      if (!terms.includes(t)) terms.push(t);
      if (terms.length > 24) break;
    }
    if (terms.length === 0) return [];
    const scored = allNotes
      .map((n) => {
        const title = (n.title || '').toLowerCase();
        const body = (n.contentText || n.content || '').toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (title.includes(t)) score += 3;
          if (body.includes(t)) score += 1;
          if (Array.isArray(n.keywords) && n.keywords.some((k) => String(k).toLowerCase().includes(t))) score += 2;
        }
        return { note: n, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => ({
        ...x.note,
        similarity: Math.min(0.95, 0.5 + x.score / 20),
      }));
    return scored;
  }, [allNotes, valueText]);

  // 点击外部：收起（不丢草稿）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const t = e.target as Node | null;
      if (!t) return;
      if (root.contains(t)) return;
      setOpen(false);
      setMaximized(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  useEffect(() => {
    return () => {
      if (bounceTimerRef.current) window.clearTimeout(bounceTimerRef.current);
      if (suggestTimerRef.current) window.clearTimeout(suggestTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const expanded = expandedRef.current;
    if (!expanded) return;

    const compute = () => {
      const scroller = expanded.querySelector(`.${styles.richEditorScroller}`) as HTMLElement | null;
      if (!scroller) return;
      const rect = expanded.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const bottomSpace = Math.max(0, window.innerHeight - rect.bottom);
      const topSafe = 98; // 顶部标题栏 + 安全边距
      const maxExpanded = Math.max(0, window.innerHeight - topSafe - bottomSpace);
      const fixedH = Math.max(0, rect.height - scrollerRect.height);
      const suggestRow = expanded.querySelector(`.${styles.floatingComposeSuggestRow}`) as HTMLElement | null;
      const suggestH = suggestRow ? suggestRow.getBoundingClientRect().height : 0;
      const reserveSuggest = Math.max(0, 114 - suggestH); // 预留最多 2 条联想高度
      const maxScroller = Math.max(120, maxExpanded - fixedH - reserveSuggest);
      expanded.style.setProperty('--floating-expanded-max', `${maxExpanded}px`);
      expanded.style.setProperty('--floating-editor-max', `${maxScroller}px`);
    };

    const raf = requestAnimationFrame(compute);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', compute);
    };
  }, [open, maximized, editorFocused, suggestNotes.length, suggestLoading]);

  // 快速记录：实时联想（停顿后请求相关笔记）
  useEffect(() => {
    if (!open) {
      setSuggestNotes([]);
      setSuggestLoading(false);
      if (suggestTimerRef.current) window.clearTimeout(suggestTimerRef.current);
      return;
    }
    const text = (valueText || '').trim();
    if (text.length < 6) {
      setSuggestNotes(localSuggestion);
      setSuggestLoading(false);
      if (suggestTimerRef.current) window.clearTimeout(suggestTimerRef.current);
      return;
    }
    if (suggestTimerRef.current) window.clearTimeout(suggestTimerRef.current);
    setSuggestLoading(true);
    if (localSuggestion.length > 0) setSuggestNotes(localSuggestion);
    const reqId = ++suggestReqIdRef.current;
    suggestTimerRef.current = window.setTimeout(() => {
      authFetch('/api/chat/related-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          limit: 5,
          threshold: 0.25,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (reqId !== suggestReqIdRef.current) return;
          const list = data?.data?.relatedNotes;
          if (Array.isArray(list)) {
            const formatted = list.map((item: any) => ({
              ...item.note,
              similarity: item.score,
            }));
            if (formatted.length > 0) {
              setSuggestNotes(formatted);
            } else {
              setSuggestNotes(localSuggestion);
            }
          } else {
            setSuggestNotes(localSuggestion);
          }
        })
        .catch(() => {
          if (reqId !== suggestReqIdRef.current) return;
          setSuggestNotes(localSuggestion);
        })
        .finally(() => {
          if (reqId !== suggestReqIdRef.current) return;
          setSuggestLoading(false);
        });
    }, 420);
  }, [open, valueText, localSuggestion]);

  const disabled = loading;
  const canSubmit = !disabled && (valueText || '').trim().length > 0;

  const submitAndClose = () => {
    if (!canSubmit) return;
    // 需求：点击保存后立刻折叠（不等待异步请求/重排/动画）
    setOpen(false);
    setMaximized(false);
    onSubmit();
  };

  return (
    <div
      ref={rootRef}
      className={`${styles.inlineCompose} ${open ? styles.floatingComposeOpen : ''} ${hover ? styles.floatingComposeHover : ''} ${maximized ? styles.floatingComposeMaximized : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* 同一个壳：折叠态是 bar，展开态变成编辑器（向上长高） */}
      <div className={`${styles.floatingComposeShell} ${bouncing ? styles.floatingComposeBounce : ''}`}>
        {!open ? (
          <button
            type="button"
            className={`${styles.floatingComposeBar} !bg-white !rounded-2xl !border !border-gray-200/50 !shadow-sm !shadow-gray-200 !px-6 !py-4 !h-auto`}
            onClick={() => {
              setOpen(true);
              setBouncing(true);
              if (bounceTimerRef.current) window.clearTimeout(bounceTimerRef.current);
              bounceTimerRef.current = window.setTimeout(() => setBouncing(false), 520);
            }}
            aria-label="打开快速记录"
          >
            <span className={styles.floatingComposeBarInner}>
              <span className={`${styles.floatingComposeBarText} !text-gray-500 !font-normal`}>
                {valueText && valueText.trim().length > 0 ? '继续编辑草稿…' : '发送消息...'}
              </span>
              {valueText && valueText.trim().length > 0 && (
                <span className={styles.floatingComposeDraftDot} aria-label="有草稿" title="有草稿" />
              )}
            </span>
          </button>
        ) : (
          <div
            className={`${styles.floatingComposeExpanded} ${editorFocused && (suggestLoading || suggestNotes.length > 0) ? styles.floatingComposeExpandedHasSuggest : styles.floatingComposeExpandedNoSuggest} !bg-white !rounded-2xl !border !border-gray-200/50 !shadow-sm !shadow-gray-200 !p-4`}
            ref={expandedRef}
          >
            {editorFocused && (suggestLoading || suggestNotes.length > 0) && (
              <div
                className={styles.floatingComposeSuggest}
                onPointerDownCapture={() => {
                  // 点击联想区时，避免编辑器 blur 触发隐藏
                  suppressBlurRef.current = true;
                }}
                onPointerUpCapture={() => {
                  window.setTimeout(() => {
                    suppressBlurRef.current = false;
                  }, 0);
                }}
              >
                {suggestLoading && suggestNotes.length === 0 ? (
                  <div className={styles.floatingComposeSuggestEmpty}>联想中…</div>
                ) : (
                  <div className={styles.floatingComposeSuggestRow}>
                    {suggestNotes.map((note) => {
                      const title = (note.title || '').trim() || '未命名';
                      const previewText = (((note as any).contentText as string | undefined) || note.content || '')
                        .trim()
                        .replace(/\s+/g, ' ');
                      const titleMatch = findMatch(title, matchTerms);
                      const snippet = buildSnippet(previewText, matchTerms);
                      return (
                        <button
                          key={note._id}
                          type="button"
                          className={styles.floatingComposeSuggestItem}
                          onClick={() => {
                            onSelectNote?.(note._id);
                            setEditorFocused(true);
                          }}
                        >
                          <div className={styles.floatingComposeSuggestTitle}>
                            {renderHighlighted(title, titleMatch)}
                          </div>
                          {snippet.text ? (
                            <div className={styles.floatingComposeSuggestPreview}>
                              {renderHighlighted(snippet.text, snippet.match)}
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div className={`${styles.floatingComposeEditor} !bg-transparent !border-none !shadow-none !text-gray-900 !p-0`}>
              <RichTextEditor
                value={valueJson}
                onChange={onChange}
                placeholder="此刻的想法、待办或总结..."
                showToolbar
                toolbarVariant={toolbarVariant}
                onFocus={() => setEditorFocused(true)}
                onBlur={() => {
                  if (suppressBlurRef.current) return;
                  setEditorFocused(false);
                  // 交给“点击外部”统一处理，避免内部交互导致误收起
                }}
                toolbarRight={
                  <>
                    <button
                      type="button"
                      className="!text-xs !px-2 !py-1 !rounded-md hover:!bg-gray-100 !text-gray-500 !bg-transparent !border-none !cursor-pointer !whitespace-nowrap !flex !items-center !justify-center !h-8 !transition-colors"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setToolbarVariant((v) => (v === 'simple' ? 'advanced' : 'simple'))}
                      aria-label={toolbarVariant === 'simple' ? '切换到复杂模式' : '切换到简单模式'}
                      title={toolbarVariant === 'simple' ? '切换到复杂模式' : '切换到简单模式'}
                    >
                      {toolbarVariant === 'simple' ? '复杂模式' : '简单模式'}
                    </button>
                    <button
                      type="button"
                      className={styles.floatingComposeMaxBtn}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setMaximized((v) => !v)}
                      aria-label={maximized ? '还原' : '最大化'}
                      title={maximized ? '还原' : '最大化'}
                    >
                      {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                  </>
                }
                onModEnter={() => {
                  submitAndClose();
                }}
              />
            </div>

            <div className={`${styles.floatingComposeActions} !border-t !border-gray-100 !pt-3 !mt-3`}>
              <div className={`${styles.floatingComposeHint} !text-gray-400`}>Cmd/Ctrl + Enter 保存</div>
              <button
                type="button"
                className={`${styles.noteEditCancel} !bg-white hover:!bg-gray-50 !text-gray-600 !border !border-gray-200 !rounded-lg !px-4 !py-1.5`}
                onClick={() => {
                  onCancel();
                  setOpen(false);
                  setMaximized(false);
                }}
                disabled={disabled}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.noteEditSave} !bg-blue-600 hover:!bg-blue-700 !text-white !rounded-lg !px-4 !py-1.5 !border-none`}
                onClick={submitAndClose}
                disabled={!canSubmit}
              >
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


