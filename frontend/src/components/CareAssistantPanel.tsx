'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '../utils/auth';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw, FileText, Loader2, ArrowRight } from 'lucide-react';
import type { CareIntro } from '../types';
import { noteReferenceDisplay } from '../utils/noteReference';
import styles from '../app/chat/chat.module.scss';


interface Props {
  onInsert: (text: string) => void;
  onSend: (text: string, introData?: CareIntro) => void | Promise<void>;
  auto?: boolean;
  cacheKey?: string;
}

export default function CareAssistantPanel({ onInsert, onSend, auto = true, cacheKey = 'care_intro_cache' }: Props) {
  const router = useRouter();
  const [intro, setIntro] = useState<CareIntro | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const fetchIntro = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await authFetch('/api/chat/robot/intro');
      const json = await res.json();
      const payload = json && json.data ? json.data : json;
      const data: CareIntro = {
        noteId: payload?.noteId ?? null,
        noteTitle: payload?.noteTitle || '',
        snippet: payload?.snippet || '',
        aiOpening: payload?.aiOpening || '',
        excerpt: typeof payload?.excerpt === 'string' ? payload.excerpt : undefined,
        sourceType: payload?.sourceType,
        imageCount: payload?.imageCount,
        firstImageSrc: payload?.firstImageSrc,
        createdAt: payload?.createdAt,
        createdAtSource: payload?.createdAtSource,
      };
      setIntro(data);
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(data));
      } catch (e) {
        console.error('Failed to save care intro to sessionStorage', e);
      }
    } catch (e: unknown) {
      console.error('CareAssistantPanel fetch error:', e);
      setIntro({
        noteId: null,
        noteTitle: '',
        snippet: '',
        aiOpening: '最近有什么新鲜事想和我分享吗？'
      });
    } finally {
      setLoading(false);
    }
  }, [cacheKey]);

  const fetchedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (fetchedKeyRef.current === cacheKey) return;
    fetchedKeyRef.current = cacheKey;

    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        setIntro(JSON.parse(cached));
        return;
      }
    } catch (e) {
      console.error('Failed to read care intro from sessionStorage', e);
    }

    fetchIntro();
  }, [cacheKey, fetchIntro]);

  if (error) return null;

  // Skeleton
  if (loading || !intro) return (
    <div className="w-full">
      <div className="relative flex flex-col gap-4 rounded-xl border border-[var(--workspace-line)] p-6 bg-[var(--workspace-canvas)] cursor-wait select-none">
        {/* Header row: icon + refresh */}
        <div className="flex items-start justify-between">
          <div className="flex h-7 w-7 items-center justify-center">
            <Sparkles className="h-4 w-4 text-gray-300/60 animate-pulse" />
          </div>
          <div className="h-8 w-8 rounded-full bg-muted/30" />
        </div>

        {/* Quote placeholder */}
        <div className="flex flex-col gap-2">
          <div className="h-5 w-full rounded-md bg-muted/50 skeletonShimmer" />
          <div className="h-5 w-3/4 rounded-md bg-muted/40 skeletonShimmer" />
        </div>

        {/* Snippet + source link placeholder */}
        <div className="flex flex-col gap-1.5">
          <div className="h-3 w-16 rounded bg-gray-200/40" />
          <div className="h-10 w-full rounded-lg bg-muted/20" />
          <div className="h-3 w-24 rounded bg-muted/20" />
        </div>

        {/* CTA placeholder */}
        <div className="h-8 w-32 self-end rounded-md bg-muted/30 skeletonShimmer" />

        <Loader2 className="absolute top-5 right-4 sm:top-6 sm:right-6 h-4 w-4 animate-spin text-gray-300/60" />
      </div>
    </div>
  );

  const sourceDisplay = noteReferenceDisplay({ title: intro.noteTitle, excerpt: intro.excerpt, content: intro.snippet, sourceType: intro.sourceType, imageCount: intro.imageCount, firstImageSrc: intro.firstImageSrc, createdAt: intro.createdAt, createdAtSource: intro.createdAtSource });

  return (
    <div className="w-full">
      <div
        className={`${styles.careSuggestion} group relative flex flex-col gap-3 rounded-xl border border-[var(--workspace-line)] break-words bg-[var(--workspace-canvas)]`}
      >
        {/* Header: icon + refresh */}
        <div className="flex items-start justify-between">
          <div className="flex min-h-7 items-center gap-2 text-sm font-medium text-[var(--workspace-ink)]">
            <Sparkles className="h-4 w-4 text-[var(--workspace-accent)]" />
            <span>{intro.noteId?.trim() ? '从你的笔记继续' : '聊聊最近'}</span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-[var(--workspace-muted)] hover:text-[var(--workspace-accent)] hover:bg-[var(--workspace-accent-soft)] transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              fetchIntro();
            }}
            title="换一个话题"
            disabled={starting}
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">换一个话题</span>
          </Button>
        </div>

        {/* Hero: AI opening quote */}
        <div className="text-[16px] font-medium text-[var(--workspace-ink)] leading-relaxed">
          {intro.aiOpening}
        </div>

        {/* Note snippet + source link */}
        {(intro.snippet || intro.noteId) && (
          <div className="flex flex-col gap-1">
            {intro.snippet && <p className="text-[14px] text-[var(--workspace-muted)] leading-relaxed line-clamp-2">
              {intro.snippet}
            </p>}
            {intro.noteId && (
              <button
                className="flex max-w-full items-start gap-1 mt-0.5 text-left text-[12px] text-[var(--workspace-muted)] hover:text-gray-600 transition-colors self-start"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/notes?highlight=${encodeURIComponent(intro.noteId!)}`);
                }}
                title="查看来源笔记"
              >
                <FileText className="mt-0.5 h-3 w-3 shrink-0" />
                {sourceDisplay.firstImageSrc && <img src={sourceDisplay.firstImageSrc} alt="笔记首图" width={28} height={28} className="shrink-0 rounded object-cover" />}
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="line-clamp-2 break-words">{sourceDisplay.label}</span>
                  {sourceDisplay.dateLabel && <time dateTime={intro.createdAt} className="whitespace-nowrap">{sourceDisplay.dateLabel}</time>}
                </span>
              </button>
            )}
          </div>
        )}

        {intro.noteId?.trim() && (
          <p className="text-[12px] text-[var(--workspace-muted)] leading-relaxed">
            开始后，每次提问会读取这篇笔记最新保存的文字。{(intro.imageCount || 0) > 0 || intro.sourceType === 'image' || intro.sourceType === 'mixed' ? '图片内容暂不识别。' : ''}
          </p>
        )}

        {/* CTA: secondary to the free-form composer */}
        <div className="flex justify-end">
          <button type="button" disabled={starting} onClick={async () => {
            setStarting(true);
            try { await onSend(intro.aiOpening, intro); }
            finally { setStarting(false); }
          }} className="inline-flex items-center gap-2 text-[13px] px-4 py-2 rounded-lg bg-[var(--workspace-accent-soft)] text-[var(--workspace-accent)] font-medium border-none hover:bg-blue-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
            <Sparkles className="h-3.5 w-3.5" />
            {intro.noteId?.trim() ? '从这条笔记聊起' : '开始聊天'}
            <ArrowRight className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          </button>
        </div>
      </div>
    </div>
  );
}
