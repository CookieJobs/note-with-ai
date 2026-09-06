'use client';

import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, PencilLine, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
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
  const [message, setMessage] = useState('');
  const [generationError, setGenerationError] = useState('');

  const load = () => { void getMemoryInsights().then(setInsights).catch(() => setInsights([])); };
  useEffect(load, []);

  const generate = async () => {
    setGenerating(true);
    setGenerationError('');
    setMessage('');
    try {
      const result = await generateMemoryInsights();
      await getMemoryInsights().then(setInsights);
      setMessage(result.created > 0 ? `已整理出 ${result.created} 条候选记忆，请逐条核对。` : '本次没有生成新的候选记忆。只有能回溯到原文的明确表达才会被保留。');
    } catch {
      setGenerationError('暂时无法整理记忆，请稍后再试。');
    } finally {
      setGenerating(false);
    }
  };

  return <main className={styles.page}>
    <TopNavigation />
    <section className={styles.content}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.kicker}><Sparkles size={15} aria-hidden="true" /> 私人记忆</span>
          <h1>AI 记忆</h1>
          <p>这是可编辑的理解，不是对你的定义。每一条都能回到原始记录核对。</p>
          <div className={styles.trustLine}><ShieldCheck size={17} aria-hidden="true" /><span>只整理你允许参与 AI 的笔记，删除或修正会立即停止后续使用。</span></div>
        </div>
        <button className={styles.primary} disabled={generating} onClick={() => { void generate(); }}>
          <Sparkles size={17} aria-hidden="true" />{generating ? '正在整理…' : '从我的笔记整理记忆'}
        </button>
      </header>
      {generationError && <p className={styles.feedbackError} role="alert">{generationError}</p>}
      {message && <p className={styles.feedback} role="status">{message}</p>}
      {insights.length === 0 ? <section className={styles.empty} aria-label="暂无 AI 记忆">
        <div className={styles.emptyIcon}><BookOpen size={22} aria-hidden="true" /></div>
        <div><h2>还没有可核对的记忆</h2><p>当记录里出现值得长期保留的明确表达时，它会先以候选形式出现在这里，等待你确认或修改。</p></div>
      </section> : <section className={styles.insightList} aria-label="AI 记忆列表">
        <div className={styles.listHeader}><h2>等待你核对的理解</h2><span>{insights.length} 条</span></div>
        {insights.map((insight) => <article className={styles.card} key={insight.id}>
        <div className={styles.cardHeader}><div><strong>{insight.displayStatement}</strong><span>{insight.status === 'corrected' ? '已按你的表述修正' : insight.confidence === 'supported' ? '有多条依据' : '等待核对'}</span></div><CheckCircle2 size={19} aria-hidden="true" /></div>
        <div className={styles.actions}>
          <button className={styles.confirm} onClick={() => { void confirmMemoryInsight(insight.id).then(load); }}><CheckCircle2 size={16} aria-hidden="true" />这是准确的</button>
          <button onClick={() => { setEditing(insight.id); setCorrection(insight.displayStatement); }}><PencilLine size={16} aria-hidden="true" />修改</button>
          <button className={styles.destructive} onClick={() => setDeleting(insight.id)}><Trash2 size={16} aria-hidden="true" />删除这条记忆</button>
          <button className={styles.evidenceToggle} aria-expanded={expanded === insight.id} onClick={() => setExpanded(expanded === insight.id ? null : insight.id)}>{expanded === insight.id ? '收起依据' : '查看依据'}</button>
        </div>
        {expanded === insight.id && <ul className={styles.evidence}>{insight.evidence.map((evidence) => <li key={evidence.noteId + evidence.noteRevision}>
          <a href={'/notes?highlight=' + evidence.noteId} onClick={() => recordProductEvent('memory_evidence_opened', { memoryId: insight.id })}>查看原文</a><blockquote>{evidence.excerpt}</blockquote>
        </li>)}</ul>}
        {editing === insight.id && <div className={styles.dialog} role="dialog" aria-label="修改 AI 记忆">
          <h3>用你的话重新表述</h3>
          <textarea value={correction} onChange={(event) => setCorrection(event.target.value)} />
          <button className={styles.confirm} onClick={() => { void correctMemoryInsight(insight.id, correction).then(() => { setEditing(null); load(); }); }}>保存修改</button>
          <button onClick={() => setEditing(null)}>取消</button>
        </div>}
        {deleting === insight.id && <div className={styles.dialog} role="dialog" aria-label="删除这条记忆">
          <h3>删除这条记忆？</h3><p>删除后，它不会再用于对话或推荐。</p>
          <button className={styles.destructive} onClick={() => { void deleteMemoryInsight(insight.id).then(() => { setDeleting(null); load(); }); }}>确认删除</button>
          <button onClick={() => setDeleting(null)}>取消</button>
        </div>}
      </article>)}</section>}
    </section>
  </main>;
}
