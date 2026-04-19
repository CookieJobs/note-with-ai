'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '../utils/auth';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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
}

export default function CareAssistantPanel({ onInsert, onSend, auto = true }: Props) {
  const router = useRouter();
  const [intro, setIntro] = useState<CareIntro | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const CACHE_KEY = 'care_intro_cache';

  // 移除 AbortController 以防止请求被意外中断
  const fetchIntro = async () => {
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
      // 更新缓存
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
      } catch (e) {
        console.error('Failed to save care intro to sessionStorage', e);
      }
    } catch (e: any) {
      console.error('CareAssistantPanel fetch error:', e);
      // 兜底文案
      setIntro({
        noteId: null,
        noteTitle: '',
        snippet: '',
        aiOpening: '最近有什么新鲜事想和我分享吗？'
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    // 优先尝试从缓存读取
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        setIntro(JSON.parse(cached));
        return;
      }
    } catch (e) {
      console.error('Failed to read care intro from sessionStorage', e);
    }

    fetchIntro();
  }, []);

  if (error) return null;
  
  // 骨架屏加载状态（保持原有布局）
  if (loading || !intro) return (
    <div className="group relative flex items-start gap-3 p-4 rounded-2xl border border-border/60 bg-gradient-to-br from-background/80 via-background/60 to-muted/40 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,0.08)] cursor-wait select-none">
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/70 via-white/40 to-transparent dark:from-white/10 dark:via-white/0" />
      <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/20 ring-1 ring-black/5 text-muted-foreground/30">
        <Sparkles className="h-4 w-4 animate-pulse" />
      </div>
      
      <div className="relative z-10 flex-1 min-w-0 flex flex-col gap-3">
        {/* 标题占位 */}
        <div className="flex flex-col gap-2 pt-1">
          <div className="h-4 w-3/4 rounded-md bg-muted/50 skeletonShimmer" />
          <div className="h-4 w-1/2 rounded-md bg-muted/50 skeletonShimmer" />
        </div>

        {/* 片段占位 */}
        <div className="flex flex-col gap-2 mt-1">
          <div className="h-3 w-16 rounded-md bg-muted/30 skeletonShimmer" />
          <div className="h-16 w-full rounded-lg bg-muted/30 border border-black/5 skeletonShimmer" />
        </div>
        
        {/* 底部链接占位 */}
        <div className="flex items-center gap-2 mt-1">
          <div className="h-5 w-24 rounded-full bg-muted/50 skeletonShimmer" />
          <div className="h-3 w-32 rounded bg-muted/30 skeletonShimmer" />
        </div>
      </div>

      <div className="relative z-10 h-8 w-8 shrink-0 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/50" />
      </div>
    </div>
  );

  return (
    <div 
      className="group relative flex items-start gap-3 p-4 rounded-2xl border border-border/60 bg-gradient-to-br from-background/80 via-background/60 to-muted/40 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.12)] hover:border-primary/30 transition-all cursor-pointer"
      onClick={() => onSend(intro.aiOpening, intro)}
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/70 via-white/40 to-transparent dark:from-white/10 dark:via-white/0" />
      <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20 text-primary shadow-[0_6px_18px_rgba(59,130,246,0.25)]">
        <Sparkles className="h-4 w-4" />
      </div>
      
      <div className="relative z-10 flex-1 min-w-0 flex flex-col gap-2">
        <div className="text-sm font-semibold text-foreground leading-relaxed tracking-tight">
          {intro.aiOpening}
        </div>

        {intro.snippet && (
          <div className="flex flex-col gap-1">
            <div className="text-[11px] text-muted-foreground/80">笔记片段</div>
            <div className="text-xs text-foreground/80 bg-muted/30 border border-border/60 rounded-lg px-3 py-2 leading-relaxed line-clamp-2">
              {intro.snippet}
            </div>
          </div>
        )}
        
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary/90">点击开始对话</span>
          {intro.noteTitle && intro.noteId && (
            <>
              <span className="text-muted-foreground/30">•</span>
              <div 
                className="flex items-center gap-1 text-xs text-primary hover:underline hover:text-primary/80 transition-colors z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/notes?highlight=${intro.noteId}`);
                }}
                title="点击查看来源笔记"
              >
                <FileText className="h-3 w-3" />
                <span className="truncate max-w-[200px]">来自：{intro.noteTitle}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="relative z-10 h-8 w-8 shrink-0 rounded-full border border-border/50 bg-background/60 text-muted-foreground shadow-sm backdrop-blur hover:text-primary hover:border-primary/40 hover:bg-primary/10 transition-all"
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
  );
}
