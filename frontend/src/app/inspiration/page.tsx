'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopNavigation from '../../components/TopNavigation';
import {
  changeInspirationState,
  getInspiration,
  getInspirationSettings,
  getUnviewedInspirationCount,
  InspirationApiError,
  listInspirations,
  markInspirationViewed,
  requestInspiration,
  setInspirationEnabled,
  type InspirationApiError as InspirationApiErrorType,
  type InspirationErrorCode,
  type InspirationItem,
  type InspirationSettings,
  type InspirationStateOperation,
  type InspirationView,
  type RequestInspirationResult,
} from '../../services/inspirationService';
import { getUser, isAuthenticated } from '../../utils/auth';
import { useAuthGuard } from '../notes/hooks/useAuthGuard';
import styles from './inspiration.module.scss';

export const dynamic = 'force-dynamic';

const errorMessages: Record<InspirationErrorCode, string> = {
  SEARCH_PROVIDER_UNAVAILABLE: '搜索服务尚未配置，请稍后再试。',
  AI_PROVIDER_UNAVAILABLE: '灵感整理服务尚未配置，请稍后再试。',
  SEARCH_PROVIDER_FAILED: '检索服务暂时不可用，请重试。',
  NO_RESULT: '这次没有找到可展示的新来源。',
  INSPIRATION_SYNTHESIS_FAILED: '暂时无法整理出可靠的结果，请重试。',
  INSPIRATION_IN_PROGRESS: '已有一条研究正在进行，请稍后再试。',
};

function messageForInspirationError(error: unknown): string {
  if (error instanceof InspirationApiError && error.code) {
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
const scheduleStatusLabels: Record<string, string> = {
  completed: '最近一次检查已完成。',
  no_result: '最近一次检查没有发现新的来源。',
  failed: '最近一次检查暂时未能完成，会在下一个检查周期再试。',
  cancelled: '最近一次检查因设置关闭而停止。',
};

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
  const user = useAuthGuard({ isAuthenticated, getUser, routerPush: router.push, redirectTo: '/auth' });
  const [item, setItem] = useState<InspirationItem | null>(null);
  const [view, setView] = useState<InspirationView>('recent');
  const [pages, setPages] = useState<Record<InspirationView, HistoryPage>>({ recent: emptyPage(), saved: emptyPage(), dismissed: emptyPage() });
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'empty'; text: string } | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [settings, setSettings] = useState<InspirationSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [unviewedCount, setUnviewedCount] = useState(0);
  const loadingViews = useRef(new Set<InspirationView>());

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    getInspirationSettings()
      .then((value) => { if (active) setSettings(value); })
      .catch(() => { if (active) setSettingsError('暂时无法加载定期发现设置。'); });
    getUnviewedInspirationCount().then((count) => { if (active) setUnviewedCount(count); }).catch(() => undefined);
    listInspirations('recent', null)
      .then((first) => {
        if (!active) return;
        setPages((previous) => ({ ...previous, recent: { ...first, loaded: true } }));
        const newest = first.items[0];
        if (newest) {
          setItem(newest);
          if (!newest.viewedAt) void markInspirationViewed(newest.id).then((viewed) => {
            if (active) {
              setItem(viewed);
              setPages((previous) => updatePages(previous, viewed));
              announceInspirationCountChanged();
              void getUnviewedInspirationCount().then(setUnviewedCount).catch(() => undefined);
            }
          }).catch(() => undefined);
        }
      })
      .catch((error: InspirationApiErrorType) => {
        if (active) setHistoryError(`加载失败，请重试。${messageForInspirationError(error)}`);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  const loadView = async (nextView: InspirationView) => {
    setView(nextView);
    setHistoryError(null);
    if (pages[nextView].loaded || loadingViews.current.has(nextView)) return;
    loadingViews.current.add(nextView);
    setListLoading(true);
    try {
      const result = await listInspirations(nextView, null);
      setPages((previous) => ({ ...previous, [nextView]: { ...result, loaded: true } }));
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
      const result = await listInspirations(view, cursor);
      setPages((previous) => {
        const current = previous[view];
        const existingIds = new Set(current.items.map((entry) => entry.id));
        return { ...previous, [view]: {
          items: [...current.items, ...result.items.filter((entry) => !existingIds.has(entry.id))],
          nextCursor: result.nextCursor, loaded: true,
        } };
      });
    } catch {
      setHistoryError('加载失败，请重试。已显示的灵感不会丢失。');
    } finally {
      setListLoading(loadingViews.current.size > 0);
    }
  };

  const openItem = async (entry: InspirationItem) => {
    setHistoryError(null);
    try {
      const full = await getInspiration(entry.id);
      setItem(full);
      if (!full.viewedAt) {
        const viewed = await markInspirationViewed(full.id);
        setItem(viewed);
        setPages((previous) => updatePages(previous, viewed));
        announceInspirationCountChanged();
        void getUnviewedInspirationCount().then(setUnviewedCount).catch(() => undefined);
      }
    } catch {
      setHistoryError('加载失败，请重试。当前灵感仍会保留。');
    }
  };

  const organize = async (operation: InspirationStateOperation) => {
    if (!item || organizing) return;
    setOrganizing(true);
    setHistoryError(null);
    try {
      const updated = await changeInspirationState(item.id, operation);
      setPages((previous) => updatePages(previous, updated));
      if (belongsInView(updated, view)) setItem(updated);
      else setItem(pages[view].items.find((entry) => entry.id !== updated.id) || null);
      if (operation === 'dismiss') void getUnviewedInspirationCount().then(setUnviewedCount).catch(() => undefined);
    } catch {
      setHistoryError('操作未成功，请重试。已显示的灵感未改变。');
    } finally {
      setOrganizing(false);
    }
  };

  const saveScheduledSetting = async (enabled: boolean) => {
    if (savingSettings) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      setSettings(await setInspirationEnabled(enabled));
    } catch {
      setSettingsError('设置未能保存，请重试。');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResearch = async () => {
    if (requesting) return;
    setRequesting(true);
    setMessage(null);
    try {
      const result: RequestInspirationResult = await requestInspiration();
      if (result.status === 'no_result') {
        setMessage({ kind: 'empty', text: '这次没有找到可展示的新来源。' });
        return;
      }
      setItem(result.item);
      setView('recent');
      setPages((previous) => updatePages(previous, result.item));
      void markInspirationViewed(result.item.id).then((viewed) => {
        setItem(viewed);
        setPages((previous) => updatePages(previous, viewed));
      }).catch(() => undefined);
    } catch (error) {
      setMessage({ kind: 'error', text: messageForInspirationError(error) });
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className={styles.page}>
      <TopNavigation />
      <main className={styles.main}>
        <header className={styles.intro}>
          <h2 className={styles.pageTitle}>从笔记继续发现</h2>
          <p className={styles.pageDescription}>结合你近期记录的主题，搜索公开资料，整理一条值得继续探索的灵感。</p>
        </header>

        <p className={styles.privacyNotice}>
          本次只会使用近期笔记的标题、关键词和短摘要；不会发送笔记正文。
        </p>

        <section className={styles.actionSection} aria-label="手动研究灵感">
          <button className={styles.researchButton} type="button" onClick={handleResearch} disabled={requesting || loading || !user}>
            {requesting ? '正在检索并整理来源…' : '为我研究一条灵感'}
          </button>
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
            <p className={styles.topicLabel}>{item.topicLabel}</p>
            <h1 id="inspiration-headline" className={styles.headline}>{item.headline}</h1>
            <p className={styles.brief}>{renderBrief(item.brief, item)}</p>
            <section className={styles.detailSection}>
              <h2>与你的记录有关</h2>
              <p>{item.whyRelevant}</p>
            </section>
            <section className={styles.detailSection}>
              <h2>可以继续想想</h2>
              <p>{item.nextQuestion}</p>
            </section>
            <section className={styles.sourcesSection} aria-labelledby="inspiration-sources">
              <h2 id="inspiration-sources">参考来源</h2>
              <ul className={styles.sourceList}>
                {item.sources.map((source) => (
                  <li key={`${source.sourceId}-${source.canonicalUrl}`} className={styles.sourceItem}>
                    <a
                      href={source.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.sourceLink}
                      aria-label={`参考来源：${source.title}`}
                    >
                      <span>{source.title}</span>
                      <small>{source.publisher}</small>
                    </a>
                    <p>{source.snippet}</p>
                  </li>
                ))}
              </ul>
            </section>
            <div className={styles.cardActions}>
              {item.userState === 'saved' ? (
                <button type="button" onClick={() => void organize('unsave')} disabled={organizing}>取消保存</button>
              ) : item.userState === 'dismissed' ? (
                <button type="button" onClick={() => void organize('restore')} disabled={organizing}>恢复灵感</button>
              ) : (
                <>
                  <button type="button" onClick={() => void organize('save')} disabled={organizing}>保存灵感</button>
                  <button type="button" onClick={() => void organize('dismiss')} disabled={organizing}>忽略</button>
                </>
              )}
            </div>
          </article>
        )}

        <section className={styles.scheduledPanel} aria-labelledby="scheduled-title">
          <div className={styles.scheduledHeading}>
            <div>
              <h2 id="scheduled-title">定期发现</h2>
              <p>在你授权后，系统会按周期从近期主题中寻找新线索。</p>
            </div>
            <label className={styles.switchLabel}>
              <span>定期为我寻找灵感</span>
              <input type="checkbox" role="switch" aria-label="定期为我寻找灵感"
                checked={settings?.enabled ?? false} disabled={!settings || savingSettings || !user}
                onChange={(event) => void saveScheduledSetting(event.target.checked)} />
            </label>
          </div>
          <p className={styles.scheduleDisclosure}>
            开启后会使用近期笔记的标题、关键词和短摘要；DeepSeek 接收这些受限元数据，Tavily 仅接收搜索查询。每 24 小时最多尝试一次，结果会进入灵感历史。开启本身不会立即开始研究。
          </p>
          {settings?.enabled && settings.nextEligibleAt && (
            <p className={styles.scheduleStatus}>预计下次检查：{new Date(settings.nextEligibleAt).toLocaleString()}（当地时间）</p>
          )}
          {settings?.lastStatus && <p className={styles.scheduleStatus}>{scheduleStatusLabels[settings.lastStatus] || '最近一次检查状态已更新。'}</p>}
          {settingsError && <p className={styles.errorMessage} role="alert">{settingsError}</p>}
        </section>

        <section className={styles.history} aria-label="灵感历史">
          <div className={styles.historyHeading}>
            <h2>灵感历史</h2>
            <span>{unviewedCount > 0 ? `${unviewedCount} 条新灵感` : '研究过的内容都会留在这里'}</span>
          </div>
          <div className={styles.historyTabs} role="tablist" aria-label="灵感历史分类">
            {views.map((entry) => (
              <button key={entry} type="button" role="tab" aria-selected={view === entry}
                className={view === entry ? styles.activeTab : ''} onClick={() => void loadView(entry)}>
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
