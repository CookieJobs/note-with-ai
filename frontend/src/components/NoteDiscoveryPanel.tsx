'use client';
/* Input: authenticated owner, stream lock and authoritative-session callback.
 * Output: bounded discovery list, evidence, feedback and confirmed draft saving.
 * Pos: ordinary chat entry; unavailable feature may render legacy suggestion. */
import { ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IChat } from '../types';
import { DiscoveryApiError, DiscoveryFeedback, discoveryOperationId, NoteDiscovery, noteDiscoveries } from '../services/noteDiscoveries';
import { DiscoveryIntent, useDiscoveryIntents } from '../hooks/discoveryIntents';
import { useNoteDiscoveries } from '../hooks/useNoteDiscoveries';
import styles from './NoteDiscoveryPanel.module.scss';

function DiscoveryCard({ item, busy, intent, patch, withdraw, feedbackDone, startSession }: { item: NoteDiscovery; busy: boolean; intent: DiscoveryIntent; patch: (patch: Partial<DiscoveryIntent>) => void; withdraw: () => void; feedbackDone: () => void; startSession: (retryOf?: string) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const error = intent.error || '';
  const setError = (error: string) => patch({error});
  const draftOpen = intent.draftOpen || false;
  const text = intent.text ?? item.draft ?? '';
  const savedId = intent.savedId || item.savedNoteId;
  const lock = useRef(false);
  const active = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const act = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try { await action(); }
    catch (err) {
      if (!active.current) return;
      if (err instanceof DiscoveryApiError && ['DISCOVERY_STALE', 'DISCOVERY_UNAVAILABLE'].includes(err.code || '')) { withdraw(); }
      else {
        if (err instanceof DiscoveryApiError && err.retryEligible && err.requestId) patch({retryEligibleRequestId: err.requestId});
        setError(err instanceof Error ? err.message : '操作没有完成，请重试。');
      }
    } finally { lock.current = false; if (active.current) setPending(false); }
  };
  const sendFeedback = (kind: DiscoveryFeedback) => void act(async () => { await noteDiscoveries.feedback(item.id, kind); feedbackDone(); });
  const sources = item.evidence.map((source, index) => <article key={`${source.noteId}-${index}`}>
    <p><Link onClick={() => dialog.current?.close()} href={`/notes?highlight=${encodeURIComponent(source.noteId)}`}>{source.title || '查看原始笔记'}</Link><span className={styles.muted}> · {new Date(source.noteDate).toLocaleDateString('zh-CN')} · 版本 {source.revision}</span></p>
    <p>“{source.excerpt}”</p>{source.hasImages && <p className={styles.muted}>这条依据只使用文字，图片尚未识别。</p>}
  </article>);
  return <article data-discovery-entry="" className={styles.card} aria-label={item.title}>
      <h3>{item.title}</h3><p className={styles.summary}>{item.observation}</p><p className={styles.muted}>{item.whyNow}</p>
      {item.qualification && <p className={styles.muted}>{item.qualification}</p>}
      <details className={styles.evidence}><summary>展开原文依据（{item.evidence.length}）</summary>{sources}</details>
      <div className={styles.actions}>
        <button className={styles.primary} disabled={pending || busy} onClick={() => void act(() => startSession(intent.retryOfRequestId))}>{pending ? '正在处理…' : item.sessionId ? '继续对话' : '继续探索'}</button>
        {intent.retryEligibleRequestId && <button disabled={pending || busy} onClick={() => void act(async () => { const prior = intent.retryEligibleRequestId!; patch({retryOfRequestId: prior, retryEligibleRequestId: undefined}); await startSession(prior); })}>额度恢复后重新尝试</button>}
        <button ref={opener} onClick={() => dialog.current?.showModal()}>查看来源</button>
        {item.draft && <button aria-expanded={draftOpen} onClick={() => patch({draftOpen: !draftOpen})}>编辑成果草稿</button>}
      </div>
      {busy && <p role="status" className={styles.muted}>当前对话回复完成后，可以继续探索。</p>}
      {draftOpen && <div className={styles.draft}><label htmlFor={`draft-${item.id}`}>成果草稿</label><p className={styles.muted}>确认后保存为一条新笔记。</p>
        <textarea id={`draft-${item.id}`} value={text} readOnly={!!intent.operation || !!savedId} maxLength={16000} onChange={event => patch({text: event.target.value})} />
        <div className={styles.actions}><button disabled={pending || !text.trim() || !!savedId} onClick={() => void act(async () => {
          const operation = intent.operation || { text, idempotencyKey: discoveryOperationId() };
          patch({operation, text});
          const result = await noteDiscoveries.save(item.id, operation);
          patch({savedId: result.note._id});
        })}>{savedId ? '已保存' : intent.operation ? '重试保存这份草稿' : '保存为新笔记'}</button>
        {savedId && <Link href={`/notes?highlight=${encodeURIComponent(savedId)}`}>查看已保存的笔记</Link>}</div>
        {intent.operation && !savedId && !pending && <p className={styles.muted}>草稿仍在这里；重试会确认同一次保存。</p>}
      </div>}
      <p className={styles.muted}>{item.suggestedAction}</p>
      <div className={styles.feedback}><button className={styles.quiet} disabled={pending} onClick={() => sendFeedback('not_interested')}>不感兴趣</button><button className={styles.quiet} disabled={pending} onClick={() => sendFeedback('not_related')}>联系不成立</button><button className={styles.quiet} disabled={pending} onClick={() => sendFeedback('already_finished')}>这件事已经结束</button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <dialog ref={dialog} className={styles.dialog} aria-label="发现的来源" onClose={() => opener.current?.focus()} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className={styles.header}><h2>发现的来源</h2><button autoFocus onClick={() => dialog.current?.close()}>关闭</button></div>{sources}
    </dialog>
  </article>;
}

export default function NoteDiscoveryPanel({ userId, busy, onSession, fallback, onBusyChange, onStartSession }: { userId: string; busy: boolean; onSession: (session: IChat) => void; fallback?: ReactNode; onBusyChange?: (busy: boolean) => void; onStartSession?: (id: string, retryOf?: string) => Promise<void> }) {
  const { data, error, loading, paused, reload, update } = useNoteDiscoveries(userId);
  const intents = useDiscoveryIntents(userId);
  const sessionLock = useRef<object | null>(null);
  const [sessionPending, setSessionPending] = useState(false);
  const busyRef = useRef(busy); busyRef.current = busy;
  const [expanded, setExpanded] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [pending, setPending] = useState(false);
  const active = useRef(true);
  const lock = useRef(false);
  const runKey = useRef<string>();
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const act = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setPending(true); setOperationError('');
    try { await fn(); } catch { if (active.current) setOperationError('操作没有完成，请重试。已有笔记不会受影响。'); }
    finally { lock.current = false; if (active.current) setPending(false); }
  };
  const startSession = async (id: string, retryOf?: string) => {
    if (sessionLock.current || busyRef.current) throw new Error('当前对话正在处理，请等待完成。');
    const token = {}; sessionLock.current = token; setSessionPending(true); onBusyChange?.(true);
    try {
      if (onStartSession) await onStartSession(id, retryOf);
      else { const result = await noteDiscoveries.session(id, retryOf); if (active.current && !busyRef.current) onSession(result.session); }
    } finally {
      if (sessionLock.current === token) { sessionLock.current = null; if (active.current) setSessionPending(false); onBusyChange?.(false); }
    }
  };
  const visible = data?.items.filter(item => item.status === 'ready' && !intents.values[item.id]?.feedback && !intents.values[item.id]?.stale) || [];
  if (data && !data.available) return <>{fallback}</>;
  const pendingRun = data && ['queued', 'running'].includes(data.run.status);
  const labels = { idle: '暂时没有新的发现', completed: '暂时没有新的发现', no_result: '暂时没有新的发现', queued: '正在整理近期笔记', running: '正在整理近期笔记', budget_exhausted: '发现额度暂时已用完', failed: '这次没有完成分析' };
  return <section className={styles.panel} aria-label="从你的笔记继续">
    <div className={styles.header}><h2>从你的笔记继续</h2>{data && <button disabled={pending} aria-pressed={data.automaticEnabled} onClick={() => void act(async () => {
      const result = await noteDiscoveries.preferences(!data.automaticEnabled);
      if (active.current) { update(previous => ({ ...previous, ...result })); reload(); }
    })}>自动发现：{data.automaticEnabled ? '开启' : '关闭'}</button>}</div>
    {loading && <p role="status">正在查看发现…</p>}
    {(error || operationError) && <p role="alert" className={styles.error}>{error || operationError} <button onClick={reload}>重新加载</button></p>}
      {Object.entries(intents.values).filter(([, intent]) => intent.feedback).map(([id]) => <div key={id} className={styles.state}><strong>已收起这条发现</strong><p className={styles.muted}>你的反馈已保存，可以撤销。</p><button disabled={pending} onClick={() => void act(async () => { await noteDiscoveries.undo(id); if (active.current) { intents.set(id, {feedback:false}); reload(); } })}>撤销</button></div>)}
    {data && <>

      {visible.slice(0, expanded ? 3 : 1).map(item => <DiscoveryCard key={item.id} item={item} intent={intents.values[item.id] || {}} patch={patch => intents.set(item.id, patch)} busy={busy || pending || sessionPending} startSession={retryOf => startSession(item.id, retryOf)}
        withdraw={() => { intents.set(item.id, {stale:true}); update(previous => ({...previous, items:previous.items.filter(record => record.id !== item.id)})); reload(); }}
        feedbackDone={() => { intents.set(item.id, {feedback:true}); update(previous => ({...previous,items:previous.items.filter(record => record.id !== item.id)})); reload(); }} />)}
      {(pendingRun || data.run.status === 'failed' || data.run.status === 'budget_exhausted' || !visible.length) && <div className={styles.state} role="status"><strong>{labels[data.run.status]}</strong><p className={styles.muted}>{pendingRun ? paused ? '分析仍未结束。你可以稍后检查状态，或先继续记录。' : '找到线索后会显示原文依据。你可以先继续写笔记。' : data.run.status === 'failed' ? '保存的笔记不会受影响，稍后可以再试一次。' : data.run.status === 'budget_exhausted' ? '已有发现仍可查看，额度恢复后再试。' : '现有笔记里还没有足够明确的线索。你可以继续记录，之后再来看看。'}</p>
        <Link href="/notes">继续记录笔记</Link>{pendingRun ? <button onClick={reload}>检查状态</button> : <button disabled={pending || data.run.status === 'budget_exhausted'} onClick={() => void act(async () => {
          runKey.current ??= discoveryOperationId(); await noteDiscoveries.run(runKey.current); if (active.current) { runKey.current = undefined; reload(); }
        })}>再检查一次</button>}
      </div>}
      {visible.length > 1 && <button className={styles.quiet} onClick={() => setExpanded(value => !value)}>{expanded ? '收起其他发现' : '查看其他发现'}</button>}
    </>}
  </section>;
}
