'use client';

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopNavigation from '../../components/TopNavigation';
import {
  getLatestInspiration,
  InspirationApiError,
  requestInspiration,
  type InspirationApiError as InspirationApiErrorType,
  type InspirationErrorCode,
  type InspirationItem,
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

export default function InspirationPage() {
  const router = useRouter();
  const user = useAuthGuard({ isAuthenticated, getUser, routerPush: router.push, redirectTo: '/auth' });
  const [item, setItem] = useState<InspirationItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'empty'; text: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    getLatestInspiration()
      .then((latest) => { if (active) setItem(latest); })
      .catch((error: InspirationApiErrorType) => {
        if (active) setMessage({ kind: 'error', text: messageForInspirationError(error) });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

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
          </article>
        )}
      </main>
    </div>
  );
}
