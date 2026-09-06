'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Bookmark, Compass, ExternalLink, ShieldCheck, Sparkles, X } from 'lucide-react';
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
      setMessage(error.code === 'SEARCH_PROVIDER_UNAVAILABLE' ? '外部检索服务尚未连接，目前不会发送任何查询。' : '请求失败，请稍后重试。');
    }
  };
  const changeProactive = async (enabled: boolean) => {
    setProactiveEnabled(enabled);
    try { await saveInspirationSettings(enabled); }
    catch { setProactiveEnabled(!enabled); setMessage('设置保存失败，请稍后重试。'); }
  };
  return <main className={styles.page}><TopNavigation /><section className={styles.content}>
    <header className={styles.hero}>
      <div><span className={styles.kicker}><Compass size={15} aria-hidden="true" /> 外部连接</span><h1>灵感</h1><p>从你在意的主题出发，挑一条有来源、值得继续读的外部内容。</p></div>
      <div className={styles.heroNote}><ShieldCheck size={18} aria-hidden="true" /><span>不做无限信息流，只保留你选择过的连接。</span></div>
    </header>
    <section className={styles.controlPanel} aria-label="灵感设置">
      <div className={styles.controlCopy}><h2>主动寻找</h2><p>你可以随时手动请求，也可以允许系统每天最多主动寻找一次。</p></div>
      <button className={styles.primary} onClick={() => { void request(); }}><Sparkles size={17} aria-hidden="true" />为我找一条新的灵感</button>
    </section>
    <label className={styles.consent}>
      <input type="checkbox" aria-label="允许主动寻找灵感" checked={proactiveEnabled} disabled={!settingsReady} onChange={(event) => { void changeProactive(event.target.checked); }} />
      <span><strong>允许主动寻找灵感</strong><small>系统每 24 小时最多发送一次经最小化处理的主题查询，不会发送笔记全文。</small></span>
    </label>
    {message && <p className={styles.feedback} role="status">{message}</p>}
    <div className={styles.sectionHeading}><h2>为你保留的灵感</h2>{items.length > 0 && <span>{items.length} 条</span>}</div>
    {items.length === 0 ? <section className={styles.empty} aria-label="暂无灵感"><div><Bookmark size={22} aria-hidden="true" /></div><p>还没有保存下来的外部连接。准备好时，可以从上方请求第一条灵感。</p></section> : items.map((item) => <article key={item._id} className={styles.card}>
      <div className={styles.cardHeader}><div><small>{item.source.publisher}</small><h3>{item.source.title}</h3></div><ArrowUpRight size={20} aria-hidden="true" /></div>
      <p className={styles.summary}>{item.summary}</p>
      <p className={styles.reason}><strong>推荐理由</strong>{item.whyThis}</p>
      <div className={styles.actions}><a href={item.source.canonicalUrl} target="_blank" rel="noreferrer" onClick={() => recordProductEvent('inspiration_source_opened', { inspirationId: item._id })}>查看来源<ExternalLink size={15} aria-hidden="true" /></a>
      <button onClick={() => { void updateInspirationStatus(item._id, 'saved').then(load); }}><Bookmark size={15} aria-hidden="true" />保存</button>
      <button className={styles.dismiss} onClick={() => { void updateInspirationStatus(item._id, 'dismissed').then(load); }}><X size={15} aria-hidden="true" />不感兴趣</button></div>
    </article>)}
  </section></main>;
}
