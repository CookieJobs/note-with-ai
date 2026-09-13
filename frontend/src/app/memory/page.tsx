'use client';

import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, PencilLine, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import TopNavigation from '../../components/TopNavigation';
import { Button } from '../../components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { confirmMemoryInsight, correctMemoryInsight, deleteMemoryInsight, generateMemoryInsights, getMemoryInsights, type MemoryInsight } from '../../services/memoryService';
import styles from './memory.module.scss';
import { recordProductEvent } from '../../services/productEventService';
import { RelationshipCue } from '../../components/ui/relationship-cue';

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
        <Button variant="default" size="lg" className={`${styles.memoryPrimaryAction} ${styles.generateButton} gap-2`} disabled={generating} aria-busy={generating || undefined} onClick={() => { void generate(); }}>
          <Sparkles size={17} aria-hidden="true" />{generating ? '正在整理…' : '从我的笔记整理记忆'}
        </Button>
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
          <Button variant="default" size="lg" className={`${styles.memoryPrimaryAction} gap-2`} onClick={() => { void confirmMemoryInsight(insight.id).then(load); }}><CheckCircle2 size={16} aria-hidden="true" />这是准确的</Button>
          <Dialog open={editing === insight.id} onOpenChange={(open) => { if (!open) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => { setEditing(insight.id); setCorrection(insight.displayStatement); }}><PencilLine size={16} aria-hidden="true" />修改</Button>
            </DialogTrigger>
            <DialogContent aria-modal="true">
              <DialogTitle>用你的话重新表述</DialogTitle>
              <DialogDescription>修改后，这条记忆会按你的表述用于后续对话和推荐。</DialogDescription>
              <textarea className={styles.dialogTextarea} aria-label="修改后的记忆" value={correction} onChange={(event) => setCorrection(event.target.value)} />
              <div className={styles.dialogActions}>
                <Button variant="default" size="lg" className={styles.memoryPrimaryAction} onClick={() => { void correctMemoryInsight(insight.id, correction).then(() => { setEditing(null); load(); }); }}>保存修改</Button>
                <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={deleting === insight.id} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleting(insight.id)}><Trash2 size={16} aria-hidden="true" />删除这条记忆</Button>
            </DialogTrigger>
            <DialogContent aria-modal="true">
              <DialogTitle>删除这条记忆</DialogTitle>
              <DialogDescription>删除后，它不会再用于对话或推荐。</DialogDescription>
              <div className={styles.dialogActions}>
                <Button variant="destructive" onClick={() => { void deleteMemoryInsight(insight.id).then(() => { setDeleting(null); load(); }); }}>确认删除</Button>
                <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="link" size="sm" className={styles.evidenceToggle} aria-expanded={expanded === insight.id} onClick={() => setExpanded(expanded === insight.id ? null : insight.id)}>{expanded === insight.id ? '收起依据' : '查看依据'}</Button>
        </div>
        {expanded === insight.id && <ul className={styles.evidence}>{insight.evidence.map((evidence) => <li key={evidence.noteId + evidence.noteRevision}>
          <RelationshipCue sourceLabel={insight.displayStatement} targetLabel="查看原文" kind="依据" explanation={evidence.excerpt} href={'/notes?highlight=' + evidence.noteId} onLinkClick={() => recordProductEvent('memory_evidence_opened', { memoryId: insight.id })} />
        </li>)}</ul>}
      </article>)}</section>}
    </section>
  </main>;
}
