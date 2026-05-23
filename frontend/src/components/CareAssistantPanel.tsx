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
      <div className="relative flex flex-col gap-5 p-6 rounded-3xl border border-gray-200/60 bg-gradient-to-b from-gray-50/80 via-white to-white shadow-[0_4px_24px_rgba(0,0,0,0.04)] cursor-wait select-none">
        {/* Header row: icon + refresh */}
        <div className="flex items-start justify-between">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100/60 ring-1 ring-gray-200/40">
            <Sparkles className="h-5 w-5 text-gray-300/60 animate-pulse" />
          </div>
          <div className="h-8 w-8 rounded-full bg-muted/30" />
        </div>

        {/* Quote placeholder */}
        <div className="flex flex-col gap-3">
          <div className="h-5 w-full rounded-md bg-muted/50 skeletonShimmer" />
          <div className="h-5 w-3/4 rounded-md bg-muted/40 skeletonShimmer" />
        </div>

        {/* Snippet placeholder */}
        <div className="flex flex-col gap-2 pl-4 border-l-2 border-gray-200/30">
          <div className="h-3 w-16 rounded bg-gray-200/40" />
          <div className="h-12 w-full rounded-lg bg-muted/20" />
        </div>

        {/* CTA placeholder */}
        <div className="h-10 w-36 mx-auto rounded-full bg-muted/30 skeletonShimmer" />

        <Loader2 className="absolute top-6 right-6 h-4 w-4 animate-spin text-gray-300/60" />
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-[680px] mx-auto">
      <div
        className="group relative flex flex-col gap-5 p-6 rounded-3xl border border-gray-200/60 bg-gradient-to-b from-gray-50/70 via-white to-white shadow-[0_4px_24px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:border-gray-300/70 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer"
        onClick={() => onSend(intro.aiOpening, intro)}
      >
        {/* Header: icon + refresh */}
        <div className="flex items-start justify-between">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-100 to-gray-50 ring-1 ring-gray-300/40 shadow-[0_4px_16px_rgba(0,0,0,0.06)] group-hover:shadow-[0_6px_20px_rgba(0,0,0,0.1)] group-hover:scale-105 transition-all duration-300">
            <Sparkles className="h-5 w-5 text-gray-600" />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full border border-gray-200/50 bg-white/80 text-gray-400 hover:text-gray-700 hover:border-gray-300/80 hover:bg-gray-50 transition-all"
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
        <div className="text-[17px] font-medium text-gray-800 leading-relaxed tracking-[-0.01em]">
          {intro.aiOpening}
        </div>

        {/* Note snippet */}
        {intro.snippet && (
          <div className="flex flex-col gap-1.5 pl-4 border-l-2 border-gray-300/50">
            <span className="text-[11px] font-medium text-gray-500/70 uppercase tracking-wider">
              笔记片段
            </span>
            <p className="text-[13px] text-gray-500 leading-relaxed line-clamp-2">
              {intro.snippet}
            </p>
          </div>
        )}

        {/* CTA: centered button */}
        <div className="flex justify-center pt-1">
          <span className="inline-flex items-center gap-2 text-[13px] px-5 py-2.5 rounded-full bg-gray-100 text-gray-700 font-medium border border-gray-200 group-hover:bg-gray-200 group-hover:border-gray-300 group-hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all">
            <Sparkles className="h-3.5 w-3.5" />
            点击开始对话
            <ArrowRight className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          </span>
        </div>

        {/* Source note link */}
        {intro.noteTitle && intro.noteId && (
          <div className="flex justify-center -mt-3">
            <button
              className="flex items-center gap-1 text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/notes?highlight=${intro.noteId}`);
              }}
              title="查看来源笔记"
            >
              <FileText className="h-3 w-3" />
              <span className="truncate max-w-[200px]">{intro.noteTitle}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
