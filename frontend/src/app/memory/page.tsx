'use client';

import { useEffect, useState } from 'react';
import TopNavigation from '../../components/TopNavigation';
import { confirmMemoryInsight, correctMemoryInsight, deleteMemoryInsight, generateMemoryInsights, getMemoryInsights, type MemoryInsight } from '../../services/memoryService';
import styles from './memory.module.scss';
import { recordProductEvent } from '../../services/productEventService';

export default function MemoryPage() {
  const [insights, setInsights] = useState<MemoryInsight[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [correction, setCorrection] = useState('');
  const [generating, setGenerating] = useState(false);

  const load = () => { void getMemoryInsights().then(setInsights).catch(() => setInsights([])); };
  useEffect(load, []);

  return <main className={styles.page}>
    <TopNavigation />
    <section className={styles.content}>
      <h1>AI 记忆</h1>
      <p>这是可编辑的理解，不是对你的定义。每一条都提供可回看的依据。</p>
      {insights.length === 0 && <div className={styles.empty}>记录多起来后，这里会出现带依据的理解。</div>}
      <button disabled={generating} onClick={() => { setGenerating(true); void generateMemoryInsights().then(load).finally(() => setGenerating(false)); }}>{generating ? '整理中…' : '从我的笔记整理记忆'}</button>
      {insights.map((insight) => <article className={styles.card} key={insight.id}>
        <strong>{insight.displayStatement}</strong>
        <span>{insight.status === 'corrected' ? '已按你的表述修正' : insight.confidence === 'supported' ? '有多条依据' : '暂定理解'}</span>
        <div className={styles.actions}>
          <button onClick={() => { void confirmMemoryInsight(insight.id).then(load); }}>这是准确的</button>
          <button onClick={() => { setEditing(insight.id); setCorrection(insight.displayStatement); }}>修改</button>
          <button onClick={() => setDeleting(insight.id)}>删除这条记忆</button>
          <button aria-expanded={expanded === insight.id} onClick={() => setExpanded(expanded === insight.id ? null : insight.id)}>查看依据</button>
        </div>
        {expanded === insight.id && <ul>{insight.evidence.map((evidence) => <li key={evidence.noteId + evidence.noteRevision}>
          <a href={'/notes?highlight=' + evidence.noteId} onClick={() => recordProductEvent('memory_evidence_opened', { memoryId: insight.id })}>查看原文</a><blockquote>{evidence.excerpt}</blockquote>
        </li>)}</ul>}
        {editing === insight.id && <div className={styles.dialog} role="dialog" aria-label="修改 AI 记忆">
          <textarea value={correction} onChange={(event) => setCorrection(event.target.value)} />
          <button onClick={() => { void correctMemoryInsight(insight.id, correction).then(() => { setEditing(null); load(); }); }}>保存修改</button>
          <button onClick={() => setEditing(null)}>取消</button>
        </div>}
        {deleting === insight.id && <div className={styles.dialog} role="dialog" aria-label="删除这条记忆">
          <p>删除后，它不会再用于对话或推荐。</p>
          <button onClick={() => { void deleteMemoryInsight(insight.id).then(() => { setDeleting(null); load(); }); }}>确认删除</button>
          <button onClick={() => setDeleting(null)}>取消</button>
        </div>}
      </article>)}
    </section>
  </main>;
}
