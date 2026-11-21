'use client';
/* Input: authenticated owner and authoritative-session callback.
 * Output: compact discovery entry, full reader, evidence and guarded draft saving.
 * Pos: Notes homepage and full-height discovery reader. */
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { ArrowRight, Settings2, Sparkles } from 'lucide-react';
import { IChat } from '../types';
import { DiscoveryApiError, DiscoveryFeedback, discoveryOperationId, NoteDiscovery, noteDiscoveries } from '../services/noteDiscoveries';
import { DiscoveryIntent, useDiscoveryIntents } from '../hooks/discoveryIntents';
import { useNoteDiscoveries } from '../hooks/useNoteDiscoveries';
import WorkspaceBackButton from './workspace/WorkspaceBackButton';
import { useWorkspace } from './workspace/WorkspaceContext';
import styles from './NoteDiscoveryPanel.module.scss';

function DiscoveryReader({ item, busy, intent, patch, withdraw, feedbackDone, startSession }: { item: NoteDiscovery; busy: boolean; intent: DiscoveryIntent; patch: (patch: Partial<DiscoveryIntent>) => void; withdraw: () => void; feedbackDone: () => void; startSession: (retryOf?: string) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const error = intent.error || '';
  const setError = (error: string) => patch({error});
  const draftOpen = intent.draftOpen || false;
  const text = intent.text ?? item.draft ?? '';
  const savedId = intent.savedId || item.savedNoteId;
  const lock = useRef(false);
  const active = useRef(true);
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
  return <article data-discovery-entry="" className={styles.reading} aria-label={item.title}>
      <h1 tabIndex={-1}>{item.title}</h1>
      <section aria-label="发现">
        <h2>发现</h2>
        <p className={styles.summary}>{item.observation}</p>
        <p>{item.whyNow}</p>
        {item.qualification && <div className={styles.qualification}><strong>判断的边界</strong><p>{item.qualification}</p></div>}
      </section>
      <section aria-label="原文依据">
        <h2>原文依据</h2>
        <details className={styles.evidence}><summary>展开原文依据（{item.evidence.length}）</summary>
        {item.evidence.map((source, index) => <div className={styles.source} key={`${source.noteId}-${index}`}>
          <p><Link href={`/notes?highlight=${encodeURIComponent(source.noteId)}`}>{source.title || '查看原始笔记'}</Link><span className={styles.muted}> · {new Date(source.noteDate).toLocaleDateString('zh-CN')} · 版本 {source.revision}</span></p>
          <blockquote>“{source.excerpt}”</blockquote>{source.hasImages && <p className={styles.muted}>这条依据只使用文字，图片尚未识别。</p>}
        </div>)}
        </details>
      </section>
      <section aria-label="下一步">
        <h2>下一步</h2>
        <p>{item.suggestedAction}</p>
        {item.draft && <button aria-expanded={draftOpen} onClick={() => patch({draftOpen: !draftOpen})}>编辑成果草稿</button>}
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
      </section>
      <div className={styles.feedback}><button className={styles.quiet} disabled={pending} onClick={() => sendFeedback('not_interested')}>不感兴趣</button><button className={styles.quiet} disabled={pending} onClick={() => sendFeedback('not_related')}>联系不成立</button><button className={styles.quiet} disabled={pending} onClick={() => sendFeedback('already_finished')}>这件事已经结束</button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <footer className={styles.readerActions}>
      <button className={styles.primary} disabled={pending || busy} onClick={() => void act(() => startSession(intent.retryOfRequestId))}>{pending ? '正在处理…' : item.sessionId ? '继续对话' : '继续探索'}</button>
      {intent.retryEligibleRequestId && <button disabled={pending || busy} onClick={() => void act(async () => { const prior = intent.retryEligibleRequestId!; patch({retryOfRequestId: prior, retryEligibleRequestId: undefined}); await startSession(prior); })}>额度恢复后重新尝试</button>}
    </footer>
  </article>;
}

// Mounted only after the explicit history action. Never merges into daily home exposure.
function DiscoveryHistory({ userId }: { userId: string }) {
  const { data, error, loading, reload } = useNoteDiscoveries(userId, true);
  return <section aria-label="历史发现" className={styles.state}>
    <h2>历史发现</h2>
    {loading && <p role="status">正在读取历史发现…</p>}
    {error && <p role="alert">{error} <button onClick={reload}>重试读取历史</button></p>}
    {data && (!data.available ? <p>历史发现暂时不可用。</p> : <>
      {!data.items.length && <p>暂时没有可查看的历史发现。</p>}
      {data.items.map(item => <article key={item.id} aria-label={item.title} className={styles.card}>
        <h3>{item.title}</h3><p>{item.observation}</p><p className={styles.muted}>{item.whyNow}</p>
        {item.qualification && <p className={styles.muted}>{item.qualification}</p>}
        <p className={styles.muted}>{new Date(item.createdAt).toLocaleDateString('zh-CN')}{item.status === 'completed' ? ' · 已结束' : item.status === 'dismissed' ? ' · 已收起' : ''}</p>
        <details className={styles.evidence}><summary>展开原文依据（{item.evidence.length}）</summary>
          {item.evidence.map((source, index) => <div key={`${source.noteId}-${index}`}>
            <Link href={`/notes?highlight=${encodeURIComponent(source.noteId)}`}>{source.title || '查看原始笔记'}</Link>
            <p className={styles.muted}>{new Date(source.noteDate).toLocaleDateString('zh-CN')} · 版本 {source.revision}</p>
            <p>“{source.excerpt}”</p>{source.hasImages && <p className={styles.muted}>这条依据只使用文字，图片尚未识别。</p>}
          </div>)}
        </details>
      </article>)}
    </>)}
  </section>;
}

const readerPrefix = '#note-discovery=';
const historyHash = '#note-discovery-history';
const settingsHash = '#note-discovery-settings';
function discoveryLocation() {
  const hash = window.location.hash;
  return hash === historyHash || hash === settingsHash || hash.startsWith(readerPrefix) ? hash : '';
}
function clearDiscoveryReaderLocation() {
  if (!discoveryLocation()) return;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function summaryFor(item: NoteDiscovery) {
  const summary = item.whyNow || item.observation;
  const first = summary.match(/^[^。！？\n]+[。！？]?/)?.[0]?.trim() || summary.trim();
  const characters = Array.from(first);
  return characters.length > 96 ? characters.slice(0, 96).join('') + '…' : first;
}

interface PanelProps {
  userId: string;
  enabled?: boolean;
  onSession: (session: IChat) => void;
  renderLayout?: (entry: ReactNode, reader?: ReactNode) => ReactNode;
}

export default function NoteDiscoveryPanel({ userId, enabled = true, onSession, renderLayout = (entry, reader) => reader ?? entry }: PanelProps) {
  const topbar = useWorkspace()?.topbarActions;
  const { data, error, loading, paused, reload, update } = useNoteDiscoveries(userId, false, enabled);
  const intents = useDiscoveryIntents(userId);
  const sessionLock = useRef(false);
  const [sessionPending, setSessionPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [location, setLocation] = useState('');
  const locationRef = useRef('');
  const navigation = useRef(0);
  const entry = useRef<string>();
  const restoreEntry = useRef(false);
  const region = useRef<HTMLElement>(null);
  const manageButton = useRef<HTMLButtonElement>(null);
  const syncLocation = useCallback(() => {
    const next = discoveryLocation();
    if (next === locationRef.current) return;
    const previous = locationRef.current;
    locationRef.current = next;
    navigation.current++;
    restoreEntry.current = !next || next === settingsHash
      || (previous === settingsHash && next.startsWith(readerPrefix) && window.history.state?.noteDiscoveryFrom !== settingsHash);
    setLocation(next);
  }, []);
  const open = (hash: string, id?: string) => {
    entry.current = id;
    window.history.pushState({ ...window.history.state, noteDiscoveryOwner: userId, noteDiscoveryFrom: locationRef.current }, '', hash);
    syncLocation();
  };
  const back = () => {
    if (window.history.state?.noteDiscoveryOwner === userId) window.history.back();
    else clearDiscoveryReaderLocation();
  };
  useEffect(() => {
    syncLocation();
    window.addEventListener('hashchange', syncLocation);
    window.addEventListener('popstate', syncLocation);
    return () => {
      window.removeEventListener('hashchange', syncLocation);
      window.removeEventListener('popstate', syncLocation);
    };
  }, [syncLocation]);
  useEffect(() => {
    if (restoreEntry.current) {
      restoreEntry.current = false;
      const buttons = region.current?.querySelectorAll<HTMLButtonElement>('[data-discovery-open]');
      const opener = Array.from(buttons ?? []).find(button => button.dataset.discoveryOpen === entry.current)
        ?? manageButton.current
        ?? region.current?.querySelector<HTMLElement>('h2, button[data-discovery-open]');
      opener?.focus({preventScroll: true});
    } else if (location) region.current?.focus({preventScroll: true});
  }, [location]);
  const [operationError, setOperationError] = useState('');
  const [pending, setPending] = useState(false);
  const active = useRef(true);
  const lock = useRef(false);
  const runKey = useRef<string>();
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const act = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setPending(true); setOperationError('');
    try { await fn(); } catch (error) {
      if (active.current) {
        const retry = error instanceof DiscoveryApiError && error.retryAt
          ? ` 可在 ${new Date(error.retryAt).toLocaleString('zh-CN')} 后再试。` : '';
        setOperationError(error instanceof DiscoveryApiError ? error.message + retry : '操作没有完成，请重试。已有笔记不会受影响。');
      }
    }
    finally { lock.current = false; if (active.current) setPending(false); }
  };
  const startSession = async (id: string, retryOf?: string) => {
    if (sessionLock.current) return;
    const startedAt = window.location.href;
    const startedNavigation = navigation.current;
    sessionLock.current = true;
    setSessionPending(true);
    try {
      const result = await noteDiscoveries.session(id, retryOf);
      if (active.current && navigation.current === startedNavigation && window.location.href === startedAt) onSession(result.session);
    } finally {
      sessionLock.current = false;
      if (active.current) setSessionPending(false);
    }
  };
  const visible = data?.items.filter(item => item.status === 'ready' && !intents.values[item.id]?.feedback && !intents.values[item.id]?.stale) || [];
  const featured = visible[0];
  const compactEntry = (data?.available || error) ? <section ref={!location ? region : undefined}
    className={styles.compact} aria-label="从你的笔记继续">
    <button type="button" className={styles.compactMain} data-discovery-open={featured?.id ?? ''}
      aria-label={featured ? `查看发现：${featured.title}` : undefined}
      onClick={() => featured ? open(readerPrefix + encodeURIComponent(featured.id), featured.id) : open(settingsHash)}>
      <Sparkles size={18} aria-hidden="true" />
      <span className={styles.compactCopy}>
        <span className={styles.compactLabel}>从你的笔记继续</span>
        {featured && <strong>{featured.title}</strong>}
      </span>
      <span className={styles.compactAction}>{featured ? '查看发现' : '打开发现'} <ArrowRight size={14} aria-hidden="true" /></span>
    </button>
  </section> : null;
  if (!enabled) return renderLayout(null);
  if (!location) return renderLayout(compactEntry);

  const parent = window.history.state?.noteDiscoveryFrom;
  const renderNavigation = (backLabel: string, showManagement = false) => {
    const manage = showManagement && <div className={styles.readerNav}>
      <button ref={manageButton} type="button" className={styles.readerSettings} onClick={() => open(settingsHash)}>
        <Settings2 size={16} aria-hidden="true" />管理发现
      </button>
    </div>;
    return <div className={styles.readerNavigation}>
      <WorkspaceBackButton label={backLabel} onClick={back} />
      {manage && (topbar ? createPortal(manage, topbar) : manage)}
    </div>;
  };
  if (location !== settingsHash) {
    const item = visible.find(candidate => readerPrefix + encodeURIComponent(candidate.id) === location);
    const history = location === historyHash;
    return renderLayout(compactEntry, <section key={location} ref={region} tabIndex={-1} className={styles.reader} aria-label={history ? '浏览历史发现' : '发现阅读'}>
      <div className={styles.readerColumn}>
        {renderNavigation(history ? '关闭历史发现' : parent === settingsHash ? '返回管理发现' : '返回笔记',
          !history && Boolean(data?.available) && parent !== settingsHash)}
        {history && data?.available ? <DiscoveryHistory userId={userId} /> : item ? <DiscoveryReader key={item.id} item={item}
          intent={intents.values[item.id] || {}} patch={patch => intents.set(item.id, patch)} busy={pending || sessionPending}
          startSession={retryOf => startSession(item.id, retryOf)}
          withdraw={() => { intents.set(item.id, {stale:true}); update(previous => ({...previous, items:previous.items.filter(record => record.id !== item.id)})); reload(); if (locationRef.current === location) back(); }}
          feedbackDone={() => { intents.set(item.id, {feedback:true}); update(previous => ({...previous,items:previous.items.filter(record => record.id !== item.id)})); reload(); if (locationRef.current === location) back(); }} />
          : <p role="status">{loading ? '正在读取发现…' : error || '这条发现已变化或暂时无法查看。'}</p>}
      </div>
    </section>);
  }
  const pendingRun = data && ['queued', 'running'].includes(data.run.status);
  const labels = { idle: '暂时没有新的发现', completed: '暂时没有新的发现', no_result: '暂时没有新的发现', queued: '正在整理近期笔记', running: '正在整理近期笔记', budget_exhausted: '发现额度暂时已用完', failed: '这次没有完成分析' };
  return renderLayout(compactEntry, <section className={styles.reader} ref={region} tabIndex={-1} aria-label="管理发现">
    <div className={styles.readerColumn}>
    {renderNavigation(parent?.startsWith(readerPrefix) ? '返回发现' : '返回笔记')}
    <div className={styles.panel}>
    <div className={styles.header}><h2 tabIndex={-1}>从你的笔记继续</h2>{data && <button disabled={pending} aria-pressed={data.automaticEnabled} onClick={() => void act(async () => {
      const result = await noteDiscoveries.preferences(!data.automaticEnabled);
      if (active.current) { update(previous => ({ ...previous, ...result })); reload(); }
    })}>自动发现：{data.automaticEnabled ? '开启' : '关闭'}</button>}</div>
    {loading && <p role="status">正在查看发现…</p>}
    {(error || operationError) && <p role="alert" className={styles.error}>{operationError || error} <button onClick={reload}>重新加载</button></p>}
      {Object.entries(intents.values).filter(([, intent]) => intent.feedback).map(([id]) => <div key={id} className={styles.state}><strong>已收起这条发现</strong><p className={styles.muted}>你的反馈已保存，可以撤销。</p><button disabled={pending} onClick={() => void act(async () => { await noteDiscoveries.undo(id); if (active.current) { intents.set(id, {feedback:false}); reload(); } })}>撤销</button></div>)}
    {data && <>

      {visible.slice(0, expanded ? 3 : 1).map(item => <article key={item.id} aria-label={item.title} className={styles.preview}>
        <div className={styles.previewText}><h3>{item.title}</h3><p>{summaryFor(item)}</p><span className={styles.muted}>依据 {new Set(item.evidence.map(source => source.noteId)).size} 条笔记</span></div>
        <button type="button" data-discovery-open={item.id} aria-label={`查看发现：${item.title}`}
          onClick={() => open(readerPrefix + encodeURIComponent(item.id), item.id)}>查看发现</button>
      </article>)}
      {(pendingRun || data.run.status === 'failed' || data.run.status === 'budget_exhausted' || !visible.length) && <div className={styles.state} role="status"><strong>{labels[data.run.status]}</strong><p className={styles.muted}>{pendingRun ? paused ? '分析仍未结束。你可以稍后检查状态，或先继续记录。' : '找到线索后会显示原文依据。你可以先继续写笔记。' : data.run.status === 'failed' ? '保存的笔记不会受影响，稍后可以再试一次。' : data.run.status === 'budget_exhausted' ? '已有发现仍可查看，额度恢复后再试。' : '现有笔记里还没有足够明确的线索。你可以继续记录，之后再来看看。'}</p>
        {pendingRun && <button onClick={reload}>检查状态</button>}
      </div>}
      <div className={styles.actions}>
        {!pendingRun && <button disabled={pending} onClick={() => void act(async () => {
          runKey.current ??= discoveryOperationId(); await noteDiscoveries.run(runKey.current);
          if (active.current) { runKey.current = undefined; reload(); }
        })}>再检查一次</button>}
        <button onClick={() => open(historyHash)}>查看历史发现</button>
      </div>
      {visible.length > 1 && <button className={styles.quiet} onClick={() => setExpanded(value => !value)}>{expanded ? '收起其他发现' : '查看其他发现'}</button>}
    </>}
    </div>
    </div>
  </section>);
}
