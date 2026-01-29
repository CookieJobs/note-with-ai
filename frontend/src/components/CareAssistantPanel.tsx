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
  onSend: (text: string) => void;
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

  if (loading) return (
    <div className="flex items-center justify-center gap-2 p-3 text-sm text-muted-foreground bg-muted/30 rounded-xl animate-pulse">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>正在寻找话题灵感...</span>
    </div>
  );
  
  if (error) return null;
  if (!intro) return null;

  return (
    <div 
      className="group relative flex items-start gap-3 p-4 rounded-xl border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden"
      onClick={() => onSend(intro.aiOpening)}
    >
      {/* 装饰边条 */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-purple-500 opacity-80" />
      
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
        <Sparkles className="h-5 w-5" />
      </div>
      
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="text-sm font-medium text-foreground leading-relaxed">
          {intro.aiOpening}
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">点击开始对话</span>
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
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
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

