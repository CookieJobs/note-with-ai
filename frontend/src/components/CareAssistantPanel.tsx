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
    fetchIntro();
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
