/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../utils/auth';
import styles from '../app/chat/chat.module.scss';

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
  const [intro, setIntro] = useState<CareIntro | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const fetchIntro = async () => {
    setLoading(true);
    setError('');
    // 移除之前的 AbortController，避免组件重渲染时误杀请求
    // abortRef.current?.abort(); 
    // abortRef.current = new AbortController();
    
    try {
      // 移除 signal 信号，不再主动取消请求，确保请求能完成
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
    } catch (e: any) {
      console.error('CareAssistantPanel fetch error:', e);
      // 即使失败，也设置一个默认兜底，保证组件展示
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
    fetchIntro();
    // 移除清理函数中的 abort，避免组件卸载/更新时中断请求
    // return () => abortRef.current?.abort();
  }, []);

  if (loading) return <div className={styles.careSuggestionLoading}>🌿 正在寻找话题灵感...</div>;
  if (error) return null;
  if (!intro) return null;

  return (
    <div className={styles.careSuggestionPanel} onClick={() => onSend(intro.aiOpening)}>
      <div className={styles.careSuggestionIcon}>✨</div>
      <div className={styles.careSuggestionContent}>
        <div className={styles.careSuggestionText}>{intro.aiOpening}</div>
        <div className={styles.careSuggestionHint}>点击开始对话</div>
      </div>
      <button 
        className={styles.careSuggestionRefresh} 
        onClick={(e) => { e.stopPropagation(); fetchIntro(); }}
        title="换一个话题"
      >
        ↻
      </button>
    </div>
  );
}
