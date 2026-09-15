'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '../utils/auth';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw, FileText, Loader2, ArrowRight } from 'lucide-react';

interface CareIntro {
  noteId: string | null;
  noteTitle: string;
  snippet: string;
  aiOpening: string;
}

interface Props {
  onInsert: (text: string) => void;
  onSend: (text: string, introData?: CareIntro) => void;
  auto?: boolean;
  cacheKey?: string;
}

export default function CareAssistantPanel({ onInsert, onSend, auto = true, cacheKey = 'care_intro_cache' }: Props) {
  const router = useRouter();
  const [intro, setIntro] = useState<CareIntro | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        aiOpening: payload?.aiOpening || ''
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
    <div className="w-full max-w-[680px] mx-auto">
      <div className="relative flex flex-col gap-4 rounded-3xl border p-5 shadow-[var(--shadow-chat-care-idle)] cursor-wait select-none [background:var(--color-surface-raised)] [border-color:var(--color-border-subtle)]">
        {/* Header row: icon + refresh */}
        <div className="flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl ring-1 [background:var(--color-surface-sunken)] [--tw-ring-color:var(--color-border-subtle)]">
            <Sparkles className="h-4 w-4 animate-pulse [color:var(--color-text-tertiary)]" />
          </div>
          <div className="h-8 w-8 rounded-full bg-muted/30" />
        </div>

        {/* Quote placeholder */}
        <div className="flex flex-col gap-2">
          <div className="h-5 w-full rounded-md bg-muted/50 skeletonShimmer" />
          <div className="h-5 w-3/4 rounded-md bg-muted/40 skeletonShimmer" />
        </div>

        {/* Snippet + source link placeholder */}
        <div className="flex flex-col gap-1.5 border-l-2 pl-4 [border-color:var(--color-border-subtle)]">
          <div className="h-3 w-16 rounded [background:var(--color-surface-sunken)]" />
          <div className="h-10 w-full rounded-lg bg-muted/20" />
          <div className="h-3 w-24 rounded bg-muted/20" />
        </div>

        {/* CTA placeholder */}
        <div className="h-8 w-32 mx-auto rounded-full bg-muted/30 skeletonShimmer" />

        <Loader2 className="absolute top-5 right-5 h-4 w-4 animate-spin [color:var(--color-text-tertiary)]" />
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-[680px] mx-auto">
      <div className="group relative flex flex-col gap-4 rounded-3xl border p-5 shadow-[var(--shadow-chat-care-idle)] transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-chat-care-hover)] [background:var(--color-surface-raised)] [border-color:var(--color-border-subtle)] hover:[border-color:var(--color-border-strong)]">
        {/* Header: icon + refresh */}
        <div className="flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl ring-1 shadow-[var(--shadow-chat-care-icon)] transition-[box-shadow,transform] duration-300 group-hover:scale-105 group-hover:shadow-[var(--shadow-chat-care-icon-hover)] [background:var(--color-surface-sunken)] [--tw-ring-color:var(--color-border-default)]">
            <Sparkles className="h-4 w-4 [color:var(--color-text-secondary)]" />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 rounded-full border transition-[color,background-color,border-color] [background:var(--color-surface-raised)] [border-color:var(--color-border-subtle)] [color:var(--color-text-tertiary)] hover:[background:var(--color-surface-sunken)] hover:[border-color:var(--color-border-default)] hover:[color:var(--color-text-primary)]"
            onClick={(e) => {
              e.stopPropagation();
              fetchIntro();
            }}
            title="换一个话题"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">换一个话题</span>
          </Button>
        </div>

        {/* Hero: AI opening quote */}
        <div className="text-[16px] font-medium leading-relaxed tracking-[-0.01em] [color:var(--color-text-primary)]">
          {intro.aiOpening}
        </div>

        {/* Note snippet + source link */}
        {intro.snippet && (
          <div className="flex flex-col gap-1 border-l-2 pl-4 [border-color:var(--color-border-default)]">
            <span className="text-[11px] font-medium uppercase tracking-wider [color:var(--color-text-tertiary)]">
              笔记片段
            </span>
            <p className="text-[13px] leading-relaxed line-clamp-2 [color:var(--color-text-secondary)]">
              {intro.snippet}
            </p>
            {intro.noteTitle && intro.noteId && (
              <button
                className="mt-0.5 flex min-h-11 min-w-11 self-start items-center gap-1 text-[12px] transition-colors [color:var(--color-text-tertiary)] hover:[color:var(--color-text-primary)]"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/notes?highlight=${intro.noteId}`);
                }}
                title="查看来源笔记"
              >
                <FileText className="h-3 w-3" />
                <span className="truncate max-w-[200px]">{intro.noteTitle}</span>
              </button>
            )}
          </div>
        )}

        {/* CTA: centered button */}
        <div className="flex justify-center">
          <Button
            type="button"
            size="lg"
            className="h-11 rounded-full border px-4 text-[13px] font-medium transition-[background-color,border-color,box-shadow] [background:var(--color-action-secondary)] [border-color:var(--color-border-default)] [color:var(--color-text-primary)] hover:shadow-[var(--shadow-chat-care-cta-hover)] hover:[background:var(--color-action-secondary-hover)] hover:[border-color:var(--color-border-strong)]"
            onClick={() => onSend(intro.aiOpening, intro)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            点击开始对话
            <ArrowRight className="h-3.5 w-3.5 opacity-50 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100" />
          </Button>
        </div>
      </div>
    </div>
  );
}
