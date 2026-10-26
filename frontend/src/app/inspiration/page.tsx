/*
Input: 当前账户、Workspace 唯一设置控制器和真实灵感 API
Output: 开放文章阅读、手动研究、历史整理和定期发现设置入口
Pos: frontend/src/app/inspiration
Note: 修改时同步本目录 README.md。
*/
'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopNavigation from '../../components/TopNavigation';
import {
  changeInspirationState,
  getInspiration,
  getUnviewedInspirationCount,
  InspirationApiError,
  listInspirations,
  markInspirationViewed,
  requestInspiration,
  type InspirationApiError as InspirationApiErrorType,
  type InspirationErrorCode,
  type InspirationItem,
  type NoteContextReason,
  type InspirationStateOperation,
  type InspirationView,
  type RequestInspirationResult,
} from '../../services/inspirationService';
import { getUser, isAuthenticated, type User } from '../../utils/auth';
import { useAuthGuard } from '../notes/hooks/useAuthGuard';
import styles from './inspiration.module.scss';
import SourceExcerpt from './components/SourceExcerpt';
import ScheduledDiscoverySettings, { scheduleStatusMessage } from './components/ScheduledDiscoverySettings';
import { useInspirationSettings, type InspirationSettingsController } from '../../hooks/useInspirationSettings';
import { useWorkspace } from '../../components/workspace/WorkspaceContext';

export const dynamic = 'force-dynamic';

const errorMessages: Record<InspirationErrorCode, string> = {
  SEARCH_PROVIDER_UNAVAILABLE: '搜索服务尚未配置，请稍后再试。',
  AI_PROVIDER_UNAVAILABLE: '灵感整理服务尚未配置，请稍后再试。',
  SEARCH_PROVIDER_FAILED: '检索服务暂时不可用，请重试。',
  NO_RESULT: '这次没有找到可展示的新来源。',
  INSPIRATION_SYNTHESIS_FAILED: '暂时无法整理出可靠的结果，请重试。',
  INSPIRATION_IN_PROGRESS: '已有一条研究正在进行，请稍后再试。',
  INSPIRATION_NOTE_CONTEXT_UNAVAILABLE: '近期笔记缺少可用的标题或摘要。',
};

const contextMessages: Record<NoteContextReason, string> = {
  no_notes: '请先记录一篇笔记，再来研究灵感。',
  summary_pending: '近期笔记的摘要正在准备中，请稍后再试。',
  context_unavailable: '近期笔记缺少可用的标题或摘要。',
};

function messageForInspirationError(error: unknown): string {
  if (error instanceof InspirationApiError && error.code) {
    if (error.code === 'INSPIRATION_NOTE_CONTEXT_UNAVAILABLE' && error.reason) return contextMessages[error.reason];
    return errorMessages[error.code] || '暂时无法完成这次研究，请重试。';
  }
  return '暂时无法完成这次研究，请重试。';
}

function renderBrief(brief: string, item: InspirationItem) {
  const sourceById = new Map(item.sources.map((source) => [source.sourceId, source]));
  return brief.split(/(【\d+】)/g).map((part, index) => {
    const citation = part.match(/^【(\d+)】$/);
    const source = citation ? sourceById.get(citation[1]) : undefined;
    if (!citation || !source) return <Fragment key={index}>{part}</Fragment>;
    return (
      <Fragment key={index}>
        <a
          className={styles.inlineCitation}
          href={source.canonicalUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`查看来源：${source.title}`}
        >
          {part}
        </a>
      </Fragment>
    );
  });
}

type HistoryPage = { items: InspirationItem[]; nextCursor: string | null; loaded: boolean };
const emptyPage = (): HistoryPage => ({ items: [], nextCursor: null, loaded: false });
const viewLabels: Record<InspirationView, string> = { recent: '最近', saved: '已保存', dismissed: '已忽略' };
const views: InspirationView[] = ['recent', 'saved', 'dismissed'];
function announceInspirationCountChanged() {
  window.dispatchEvent(new Event('inspiration-count-changed'));
}

function belongsInView(item: InspirationItem, view: InspirationView): boolean {
  return view === 'recent' ? item.userState !== 'dismissed' : item.userState === view;
}

function updatePages(pages: Record<InspirationView, HistoryPage>, changed: InspirationItem): Record<InspirationView, HistoryPage> {
  return Object.fromEntries(views.map((view) => {
    const page = pages[view];
    if (!page.loaded) return [view, page];
    const existing = page.items.filter((entry) => entry.id !== changed.id);
    return [view, { ...page, items: belongsInView(changed, view) ? [changed, ...existing] : existing }];
  })) as Record<InspirationView, HistoryPage>;
}

export default function InspirationPage() {
  const router = useRouter();
  const workspace = useWorkspace();
  const guardedUser = useAuthGuard({ isAuthenticated, getUser, routerPush: router.push, redirectTo: '/auth' });
  const user = workspace?.user === undefined ? guardedUser : workspace.user;
  return workspace
    ? <InspirationContent key={user?.id || 'pending'} user={user} controller={workspace.inspirationSettings} />
    : <StandaloneInspiration key={user?.id || 'pending'} user={user} />;
}

// Only standalone rendering mounts a controller; the production shell owns its one instance.
function StandaloneInspiration({ user }: { user: User | null }) {
  const controller = useInspirationSettings(user?.id);
  return <InspirationContent user={user} controller={controller} />;
}

function InspirationContent({ user, controller }: { user: User | null; controller?: InspirationSettingsController }) {
  const workspace = useWorkspace();
  const [item, setItem] = useState<InspirationItem | null>(null);
  const [view, setView] = useState<InspirationView>('recent');
  const [pages, setPages] = useState<Record<InspirationView, HistoryPage>>({ recent: emptyPage(), saved: emptyPage(), dismissed: emptyPage() });
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'empty'; text: string } | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [unviewedCount, setUnviewedCount] = useState(0);
  const loadingViews = useRef(new Set<InspirationView>());
  const selection = useRef(0);
  const active = useRef(true);
  const requestLock = useRef(false);
  const organizeLock = useRef(false);
  const countRequest = useRef(0);
  const historyRevision = useRef(0);
  const refreshCount = useCallback(() => {
    const request = ++countRequest.current;
    void getUnviewedInspirationCount().then((count) => {
      if (active.current && request === countRequest.current) setUnviewedCount(count);
    }).catch(() => undefined);
  }, []);
  const invalidateSelection = useCallback(() => { ++selection.current; }, []);
  const markViewed = useCallback((entry: InspirationItem, selected: number) => {
    if (entry.viewedAt) return;
    void markInspirationViewed(entry.id).then((viewed) => {
      if (!active.current) return;
      ++historyRevision.current;
      // Merge read metadata only, preserving any later save/dismiss result.
      if (selection.current === selected) setItem((current) => current?.id === viewed.id ? { ...current, viewedAt: viewed.viewedAt } : current);
      setPages((previous) => Object.fromEntries(views.map((key) => [key, { ...previous[key], items: previous[key].items.map((current) => current.id === viewed.id ? { ...current, viewedAt: viewed.viewedAt } : current) }])) as Record<InspirationView, HistoryPage>);
      announceInspirationCountChanged();
      refreshCount();
    }).catch(() => undefined);
  }, [refreshCount]);

  const loadHistoryPage = useCallback(async (targetView: InspirationView, cursor: string | null, isCurrent: () => boolean = () => true) => {
    while (active.current && isCurrent()) {
      const revision = historyRevision.current;
      const result = await listInspirations(targetView, cursor);
      if (!active.current || !isCurrent()) return null;
      // A successful mutation makes any earlier snapshot stale. Read the same
      // server filter/cursor again; never invent membership or pagination data.
      if (revision !== historyRevision.current) continue;
      setPages((previous) => {
        if (!cursor) return { ...previous, [targetView]: { ...result, loaded: true } };
        const current = previous[targetView];
        const existingIds = new Set(current.items.map((entry) => entry.id));
        return { ...previous, [targetView]: {
          items: [...current.items, ...result.items.filter((entry) => !existingIds.has(entry.id))],
          nextCursor: result.nextCursor, loaded: true,
        } };
      });
      return result;
    }
    return null;
  }, []);

  useEffect(() => {
    active.current = true;
    if (!user?.id) return () => { active.current = false; };
    let mounted = true;
    const selected = selection.current;
    setLoading(true);
    refreshCount();
    loadHistoryPage('recent', null, () => mounted)
      .then((first) => {
        if (!mounted || !first) return;
        const newest = first.items[0];
        if (newest && selection.current === selected) {
          setItem(newest);
          markViewed(newest, selected);
        }
      })
      .catch((error: InspirationApiErrorType) => {
        if (mounted) setHistoryError(`加载失败，请重试。${messageForInspirationError(error)}`);
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; active.current = false; invalidateSelection(); };
  }, [user?.id, refreshCount, markViewed, invalidateSelection, loadHistoryPage]);

  const loadView = async (nextView: InspirationView) => {
    setView(nextView);
    setHistoryError(null);
    if (pages[nextView].loaded || loadingViews.current.has(nextView)) return;
    loadingViews.current.add(nextView);
    setListLoading(true);
    try {
      await loadHistoryPage(nextView, null);
    } catch {
      setHistoryError('加载失败，请重试。');
    } finally {
      loadingViews.current.delete(nextView);
      setListLoading(loadingViews.current.size > 0);
    }
  };

  const loadMore = async () => {
    const cursor = pages[view].nextCursor;
    if (!cursor || listLoading) return;
    setListLoading(true);
    setHistoryError(null);
    try {
      await loadHistoryPage(view, cursor);
    } catch {
      setHistoryError('加载失败，请重试。已显示的灵感不会丢失。');
    } finally {
      setListLoading(loadingViews.current.size > 0);
    }
  };

  const openItem = async (entry: InspirationItem) => {
    const selected = ++selection.current;
    setHistoryError(null);
    try {
      const full = await getInspiration(entry.id);
      if (!active.current || selection.current !== selected) return;
      setItem(full);
      markViewed(full, selected);
    } catch {
      if (active.current && selection.current === selected) setHistoryError('加载失败，请重试。当前灵感仍会保留。');
    }
  };

  const organize = async (operation: InspirationStateOperation) => {
    if (!item || organizeLock.current) return;
    organizeLock.current = true;
    const selected = ++selection.current;
    setOrganizing(true);
    setHistoryError(null);
    try {
      const updated = await changeInspirationState(item.id, operation);
      if (!active.current) return;
      ++historyRevision.current;
      setPages((previous) => updatePages(previous, updated));
      if (selection.current === selected) {
        if (belongsInView(updated, view)) setItem(updated);
        else {
          const fallback = pages[view].items.find((entry) => entry.id !== updated.id) || null;
          setItem(fallback);
          if (fallback) markViewed(fallback, selected);
        }
      }
      if (operation === 'dismiss') refreshCount();
    } catch {
      if (active.current) setHistoryError('操作未成功，请重试。已显示的灵感未改变。');
    } finally {
      organizeLock.current = false;
      if (active.current) setOrganizing(false);
    }
  };

  const handleResearch = async () => {
    if (requestLock.current || loading || !user) return;
    requestLock.current = true;
    const selected = ++selection.current;
    setRequesting(true);
    setMessage(null);
    try {
      const result: RequestInspirationResult = await requestInspiration();
      if (!active.current) return;
      if (result.status === 'no_result') {
        setMessage({ kind: 'empty', text: '这次没有找到可展示的新来源。' });
        return;
      }
      ++historyRevision.current;
      setPages((previous) => updatePages(previous, result.item));
      if (selection.current === selected) {
        setItem(result.item);
        setView('recent');
        markViewed(result.item, selected);
      }
    } catch (error) {
      if (active.current) setMessage({ kind: 'error', text: messageForInspirationError(error) });
    } finally {
      requestLock.current = false;
      if (active.current) setRequesting(false);
    }
  };

  return (
    <div className={styles.page}>
      <TopNavigation />
      <main className={styles.main}>
        <header className={styles.intro}>
          <div><h2 className={styles.pageTitle}>灵感</h2><p className={styles.pageDescription}>从近期笔记出发，发现值得继续探索的线索。</p></div>
          <button className={styles.researchButton} type="button" onClick={handleResearch} disabled={requesting || loading || !user}>
            {requesting ? '正在检索并整理来源…' : '为我研究一条灵感'}
          </button>
        </header>

        <p className={styles.privacyNotice}>
          本次只会使用近期笔记的标题（若有）和短摘要；不会发送笔记正文。
        </p>

        <section className={styles.actionSection} aria-label="手动研究灵感">
          {requesting && <p className={styles.progress} role="status">正在阅读近期主题并检索公开来源，请稍候。</p>}
          {loading && <p className={styles.progress} role="status">正在加载最近的灵感…</p>}
          {!loading && message && (
            <p className={message.kind === 'error' ? styles.errorMessage : styles.emptyMessage} role="status" aria-live="polite">
              {message.text}
            </p>
          )}
        </section>

        {item && (
          <article className={styles.researchCard} aria-labelledby="inspiration-headline">
            <div className={styles.articleMeta}><p className={styles.topicLabel}>{item.topicLabel}</p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</time></div>
            <h1 id="inspiration-headline" className={styles.headline}>{item.headline}</h1>
            <p className={styles.brief}>{renderBrief(item.brief, item)}</p>
            <section className={styles.detailSection}>
              <h2>与你的记录有关</h2>
              <p>{item.whyRelevant}</p>
            </section>
            <section className={styles.nextPrompt}>
              <h2>下一问题</h2>
              <p>{item.nextQuestion}</p>
            </section>
            <section className={styles.sourcesSection} aria-labelledby="inspiration-sources">
              <h2 id="inspiration-sources">参考来源</h2>
              <ul className={styles.sourceList}>
                {item.sources.map((source) => (
                  <li key={`${item.id}-${source.sourceId}-${source.canonicalUrl}`} className={styles.sourceItem}>
                    <a
                      href={source.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.sourceLink}
                      aria-label={`参考来源：${source.title}`}
                    >
                      <span className={styles.sourceNumber}>{source.sourceId}</span><span>{source.title}</span>
                    </a>
                    <p className={styles.sourceMeta}>{source.publisher}{source.retrievedAt && <> · 检索于 <time dateTime={source.retrievedAt}>{new Date(source.retrievedAt).toLocaleDateString('zh-CN')}</time></>}</p>
                    <SourceExcerpt snippet={source.snippet} />
                  </li>
                ))}
              </ul>
            </section>
            <div className={styles.cardActions}>
              {item.userState === 'saved' ? (
                <button type="button" className={styles.organizeButton} onClick={() => void organize('unsave')} disabled={organizing}>取消保存</button>
              ) : item.userState === 'dismissed' ? (
                <button type="button" className={styles.organizeButton} onClick={() => void organize('restore')} disabled={organizing}>恢复灵感</button>
              ) : (
                <>
                  <button type="button" className={styles.organizeButton} onClick={() => void organize('save')} disabled={organizing}>保存灵感</button>
                  <button type="button" className={styles.organizeButton} onClick={() => void organize('dismiss')} disabled={organizing}>忽略</button>
                </>
              )}
            </div>
          </article>
        )}

        {workspace?.openSettings ? (
          <section className={styles.discoveryRow} aria-label="定期发现">
            <div>
              <h2>定期发现</h2>
              <p>{controller?.settings ? (controller.settings.enabled ? '已开启，新的发现会进入灵感历史。' : '已关闭。你仍可随时手动研究。') : '定期发现设置暂未就绪。你仍可手动研究。'}</p>
              {controller?.settings?.enabled && controller.settings.nextEligibleAt && <p>下次可检查：{new Date(controller.settings.nextEligibleAt).toLocaleString()}（当地时间）</p>}
              {controller?.settings?.lastStatus && <p>{scheduleStatusMessage(controller.settings)}</p>}
              {controller?.error && <p className={styles.errorMessage} role="alert">{controller.error}</p>}
            </div>
            <button type="button" className={styles.manageDiscovery} onClick={() => workspace.openSettings?.('inspiration')}>管理定期发现</button>
          </section>
        ) : controller && <ScheduledDiscoverySettings controller={controller} />}

        <section className={styles.history} aria-label="灵感历史">
          <div className={styles.historyHeading}>
            <h2>灵感历史</h2>
            <span>{unviewedCount > 0 ? `${unviewedCount} 条新灵感` : '研究过的内容都会留在这里'}</span>
          </div>
          <div className={styles.historyTabs} role="tablist" aria-label="灵感历史分类">
            {views.map((entry) => (
              <button key={entry} type="button" role="tab" aria-selected={view === entry}
                className={`${styles.historyTab} ${view === entry ? styles.activeTab : ''}`} onClick={() => void loadView(entry)}>
                {viewLabels[entry]}
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={`${viewLabels[view]}灵感`}>
            {pages[view].loaded && pages[view].items.length === 0 && (
              <p className={styles.historyEmpty}>{view === 'recent' ? '这里还没有灵感。你可以先研究一条，之后再回来查看。' : `这里还没有${viewLabels[view]}的灵感。`}</p>
            )}
            <ul className={styles.historyList}>
              {pages[view].items.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className={styles.historyRow} onClick={() => void openItem(entry)}
                    aria-current={item?.id === entry.id ? 'true' : undefined}>
                    <span className={styles.historyRowTitle}>{entry.headline}</span>
                    <span className={styles.historyMeta}>
                      {entry.origin === 'scheduled' && <span>定期发现</span>}
                      {entry.origin === 'scheduled' && !entry.viewedAt && <span className={styles.newMarker}>新</span>}
                      {entry.userState === 'saved' && <span>已保存</span>}
                      <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString('zh-CN')}</time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {pages[view].nextCursor && (
              <button type="button" className={styles.loadMore} onClick={() => void loadMore()} disabled={listLoading}>
                {listLoading ? '正在加载…' : '加载更多灵感'}
              </button>
            )}
            {listLoading && !pages[view].nextCursor && <p className={styles.progress} role="status">正在加载灵感…</p>}
            {historyError && <p className={styles.errorMessage} role="alert">{historyError}</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
