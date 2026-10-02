'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './profile.module.scss';
import { getProfileTopics, retryFailedProfileTopics, TopicRetryResponse, TopicScope, UserTopicIndexDto } from '../../services/profileTopicsService';

const scopes: Array<{ id: TopicScope; label: string }> = [
  { id: 'all', label: '全部笔记' },
  { id: 'year', label: '近一年' },
  { id: 'sixMonths', label: '近六个月' },
];
const POLL_INTERVAL_MS = 4_000;
const MAX_POLLS = 5;

function formatDate(value: string | null): string {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function ProfileTopicsSection() {
  const [scope, setScope] = useState<TopicScope>('all');
  const [cache, setCache] = useState<Partial<Record<TopicScope, UserTopicIndexDto>>>({});
  const [loading, setLoading] = useState<Partial<Record<TopicScope, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<TopicScope, boolean>>>({});
  const [retrying, setRetrying] = useState(false);
  const [retryState, setRetryState] = useState<Partial<Record<TopicScope, { message: string; cooldownUntil: number | null }>>>({});
  const [now, setNow] = useState(Date.now());
  const requestIds = useRef<Partial<Record<TopicScope, number>>>({});
  const controllers = useRef<Partial<Record<TopicScope, AbortController>>>({});
  const mounted = useRef(false);
  const pollCounts = useRef<Partial<Record<TopicScope, number>>>({});

  const load = useCallback(async (target: TopicScope, options: { manual?: boolean; silent?: boolean } = {}) => {
    const id = (requestIds.current[target] ?? 0) + 1;
    requestIds.current[target] = id;
    controllers.current[target]?.abort();
    const controller = new AbortController();
    controllers.current[target] = controller;
    if (options.manual) pollCounts.current[target] = 0;
    if (mounted.current) {
      setErrors((previous) => ({ ...previous, [target]: false }));
      if (!options.silent) setLoading((previous) => ({ ...previous, [target]: true }));
    }
    try {
      const data = await getProfileTopics(target, controller.signal);
      if (mounted.current && requestIds.current[target] === id && !controller.signal.aborted) {
        setCache((previous) => ({ ...previous, [target]: data }));
        setErrors((previous) => ({ ...previous, [target]: false }));
      }
    } catch {
      if (mounted.current && requestIds.current[target] === id && !controller.signal.aborted) {
        setErrors((previous) => ({ ...previous, [target]: true }));
      }
    } finally {
      if (mounted.current && requestIds.current[target] === id) setLoading((previous) => ({ ...previous, [target]: false }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load('all');
    const activeControllers = controllers.current;
    return () => {
      mounted.current = false;
      Object.values(activeControllers).forEach((controller) => controller?.abort());
    };
  }, [load]);

  const data = cache[scope];
  const currentLoading = Boolean(loading[scope]);
  const currentError = Boolean(errors[scope]);
  const polling = Boolean(data && (data.indexStatus === 'building' || (data.indexStatus === 'partial' && data.pendingNotesInRange > 0)));
  const pollCount = pollCounts.current[scope] ?? 0;
  const pollExhausted = polling && pollCount >= MAX_POLLS;

  const cooldownUntil = retryState[scope]?.cooldownUntil ?? null;
  useEffect(() => {
    if (!data || !polling || currentLoading || currentError || pollExhausted) return;
    const timer = window.setTimeout(() => {
      pollCounts.current[scope] = (pollCounts.current[scope] ?? 0) + 1;
      void load(scope, { silent: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [data, scope, polling, currentLoading, currentError, pollExhausted, load]);

  useEffect(() => {
    if (cooldownUntil === null) return;
    if (cooldownUntil <= Date.now()) {
      setRetryState((previous) => previous[scope]?.cooldownUntil === cooldownUntil
        ? { ...previous, [scope]: { ...previous[scope]!, cooldownUntil: null } }
        : previous);
      return;
    }
    const timer = window.setTimeout(() => {
      setNow(Date.now());
      setRetryState((previous) => previous[scope]?.cooldownUntil === cooldownUntil
        ? { ...previous, [scope]: { ...previous[scope]!, cooldownUntil: null } }
        : previous);
    }, Math.max(0, cooldownUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [cooldownUntil, scope]);

  const handleRetry = async () => {
    const target = scope;
    if (retrying || (cooldownUntil !== null && now < cooldownUntil)) return;
    setRetrying(true);
    setRetryState((previous) => ({ ...previous, [target]: { message: '', cooldownUntil: null } }));
    try {
      const result: TopicRetryResponse = await retryFailedProfileTopics(target);
      if (!mounted.current) return;
      const responseText = retrySummary(result);
      let nextCooldown: number | null = null;
      // A partial rate limit must not block retries for eligible failed notes.
      if (result.rateLimitedCount > 0 && result.acceptedCount === 0 && result.alreadyRunningCount === 0 && result.nextRetryAt) {
        const until = new Date(result.nextRetryAt).getTime();
        if (Number.isFinite(until) && until > Date.now()) nextCooldown = until;
      }
      setRetryState((previous) => ({ ...previous, [target]: { message: responseText, cooldownUntil: nextCooldown } }));
      if (nextCooldown) setNow(Date.now());
      void load(target, { manual: true, silent: Boolean(cache[target]) });
    } catch {
      if (mounted.current) setRetryState((previous) => ({ ...previous, [target]: { message: '提交失败，请稍后重试。', cooldownUntil: null } }));
    } finally {
      if (mounted.current) setRetrying(false);
    }
  };

  const selectScope = (next: TopicScope) => {
    if (next === scope) return;
    setScope(next);
    if (!cache[next]) void load(next);
  };

  const cooldownActive = cooldownUntil !== null && now < cooldownUntil;
  return (
    <section className={`${styles.sectionGroup} ${styles.topicsSection}`} aria-labelledby="topics-title">
      <div className={styles.sectionGroupHeader}>
        <h2 id="topics-title" className={styles.sectionGroupTitle}>笔记话题</h2>
        <button className={styles.btnGhostSm} type="button" onClick={() => void load(scope, { manual: true, silent: Boolean(data) })} disabled={currentLoading}>
          {currentLoading && !data ? '加载中…' : '刷新话题'}
        </button>
      </div>
      <p className={styles.sectionGroupHint}>按笔记中提取到的话题整理，不代表兴趣程度。</p>
      <div className={styles.topicScopeTabs} role="tablist" aria-label="笔记时间范围">
        {scopes.map((item) => <button key={item.id} type="button" role="tab" aria-selected={scope === item.id} className={scope === item.id ? styles.topicScopeActive : styles.topicScopeTab} onClick={() => selectScope(item.id)}>{item.label}</button>)}
      </div>

      {currentError && <div className={styles.topicError} role="alert">
        <p>{data ? '话题刷新失败，已保留上次成功数据。' : '话题加载失败，请重试。'}</p>
        <button className={styles.btnOutlineSm} type="button" onClick={() => void load(scope, { manual: true, silent: Boolean(data) })}>{data ? '重试刷新' : '重试话题加载'}</button>
      </div>}
      {currentLoading && !data && !currentError && <p className={styles.stateMessage}>正在加载笔记话题…</p>}
      {!data && !currentLoading && !currentError && <p className={styles.stateMessage}>话题数据暂不可用。</p>}

      {data && <>
        <div className={styles.topicCoverage} aria-label="笔记话题整理进度">已整理 {data.readyNotesInRange} / {data.totalNotesInRange} 篇笔记</div>
        {data.updatedAt && <p className={styles.topicStatus}>最近整理：{formatDate(data.updatedAt)}</p>}
        {data.totalNotesInRange === 0 && scope === 'all' && <div className={styles.topicEmpty}>
          <p>还没有笔记，写下第一篇后这里会整理其中的话题。</p>
          <Link className={styles.btnOutlineSm} href="/notes">创建第一篇笔记</Link>
        </div>}
        {data.totalNotesInRange === 0 && scope !== 'all' && <div className={styles.topicEmpty}>
          <p>这个时间范围内还没有笔记。</p>
          <button className={styles.btnOutlineSm} type="button" onClick={() => selectScope('all')}>查看全部笔记</button>
        </div>}
        {data.totalNotesInRange > 0 && <>
          {data.topics.length > 0 ? <ul className={styles.topicList} aria-label="当前已整理的话题">
            {data.topics.map((topic) => <li key={topic.topic} className={styles.topicChip}><span>{topic.topic}</span><span className={styles.topicCount}>{topic.noteCount} 篇</span></li>)}
          </ul> : data.indexStatus === 'ready' ? <p className={styles.stateMessage}>当前笔记还没有可展示的话题。</p> : null}

          {data.staleSnapshot && <div className={styles.topicSnapshot}>
            <p className={styles.topicSnapshotLabel}>{data.staleSnapshot.label} · {data.staleSnapshot.noteCount} 篇笔记{data.staleSnapshot.indexedAt ? ` · 最近整理 ${formatDate(data.staleSnapshot.indexedAt)}` : ''}</p>
            {data.staleSnapshot.topics.length > 0 && <ul className={styles.topicList} aria-label={`旧快照话题，${data.staleSnapshot.noteCount} 篇笔记，不计入当前覆盖`}>
              {data.staleSnapshot.topics.map((topic) => <li key={topic.topic} className={styles.topicChip}><span>{topic.topic}</span><span className={styles.topicCount}>{topic.noteCount} 篇</span></li>)}
            </ul>}
          </div>}

          {data.pendingNotesInRange > 0 && <p className={styles.topicStatus} role="status">还有 {data.pendingNotesInRange} 篇笔记正在整理。</p>}
          {data.failedNotesInRange > 0 && <div className={styles.topicFailure}>
            <p>{data.failedNotesInRange} 篇笔记整理失败{data.lastErrorAt ? ` · 最近失败 ${formatDate(data.lastErrorAt)}` : ''}</p>
            <button className={styles.btnOutlineSm} type="button" onClick={() => void handleRetry()} disabled={retrying || cooldownActive}>{retrying ? '正在提交…' : '重试失败笔记'}</button>
          </div>}
          {retryState[scope]?.message && <p className={styles.topicStatus} role="status">{retryState[scope]?.message}</p>}
          {cooldownActive && <p className={styles.topicStatus} role="status">下次可重试：{formatDate(new Date(cooldownUntil).toISOString())}</p>}
          {pollExhausted && <p className={styles.topicStatus} role="status">话题仍在后台处理，可手动刷新查看进度。</p>}
        </>}
      </>}
    </section>
  );
}

function retrySummary(result: TopicRetryResponse): string {
  const parts: string[] = [];
  if (result.acceptedCount) parts.push(`已安排 ${result.acceptedCount} 篇失败笔记重试`);
  if (result.alreadyRunningCount) parts.push(`${result.alreadyRunningCount} 篇正在处理`);
  if (result.rateLimitedCount) parts.push(`${result.rateLimitedCount} 篇暂受冷却限制`);
  return parts.length ? `${parts.join('，')}。` : '当前没有可重试的失败笔记。';
}
