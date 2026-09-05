'use client';

import { useCallback, useEffect, useState } from 'react';
import TopNavigation from '../../components/TopNavigation';
import { getInspirationJob, getInspirationSettings, getInspirations, requestInspiration, saveInspirationSettings, updateInspirationStatus } from '../../services/inspirationService';
import styles from './inspiration.module.scss';
import { recordProductEvent } from '../../services/productEventService';

export default function InspirationPage() {
  const [items, setItems] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [proactiveEnabled, setProactiveEnabled] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const load = useCallback(() => { void getInspirations().then(setItems).catch(() => setItems([])); }, []);
  useEffect(() => {
    load();
    void getInspirationSettings().then((settings) => setProactiveEnabled(settings.proactiveEnabled)).finally(() => setSettingsReady(true));
  }, [load]);
  const request = async () => {
    try {
      setMessage('正在寻找一条有来源的灵感…');
      const job = await requestInspiration();
      let attempts = 0;
      const timer = window.setInterval(() => {
        void getInspirationJob(job.jobId).then((value) => {
          attempts += 1;
          if (['completed', 'no_result', 'failed'].includes(value.status) || attempts >= 8) {
            window.clearInterval(timer);
            setMessage(value.status === 'completed' ? '找到了一条新灵感。' : value.status === 'no_result' ? '这次没有找到值得推荐的内容。' : '目前无法寻找新灵感。');
            load();
          }
        });
      }, 1500);
    } catch (error: any) {
      setMessage(error.code === 'SEARCH_PROVIDER_UNAVAILABLE' ? '目前无法寻找新灵感。' : '请求失败，请稍后重试。');
    }
  };
  const changeProactive = async (enabled: boolean) => {
    setProactiveEnabled(enabled);
    try { await saveInspirationSettings(enabled); }
    catch { setProactiveEnabled(!enabled); setMessage('设置保存失败，请稍后重试。'); }
  };
  return <main className={styles.page}><TopNavigation /><section className={styles.content}>
    <h1>灵感</h1><p>数量有限、来源明确的外部连接，不是无限信息流。</p>
    <label className={styles.consent}>
      <input type="checkbox" aria-label="允许主动寻找灵感" checked={proactiveEnabled} disabled={!settingsReady} onChange={(event) => { void changeProactive(event.target.checked); }} />
      <span><strong>允许主动寻找灵感</strong><small>开启后，系统每 24 小时最多一次向外部搜索服务发送经最小化处理的主题查询；不会发送笔记全文。</small></span>
    </label>
    <button className={styles.primary} onClick={() => { void request(); }}>为我找一条新的灵感</button>
    {message && <p role="status">{message}</p>}
    {items.map((item) => <article key={item._id} className={styles.card}>
      <h2>{item.source.title}</h2><small>{item.source.publisher}</small><p>{item.summary}</p>
      <p><strong>为什么给我看：</strong>{item.whyThis}</p>
      <a href={item.source.canonicalUrl} target="_blank" rel="noreferrer" onClick={() => recordProductEvent('inspiration_source_opened', { inspirationId: item._id })}>查看来源（将在新窗口打开）</a>
      <button onClick={() => { void updateInspirationStatus(item._id, 'saved').then(load); }}>保存</button>
      <button onClick={() => { void updateInspirationStatus(item._id, 'dismissed').then(load); }}>不感兴趣</button>
    </article>)}
  </section></main>;
}
