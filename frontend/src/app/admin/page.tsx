'use client';
import { useEffect, useState } from 'react';
import { adminFetch } from './lib/adminApi';
import MetricCard from './components/MetricCard';
import TrendChart from './components/TrendChart';
import styles from './admin.module.scss';
export default function AdminOverviewPage() { const [data, setData] = useState<any>(); const [error, setError] = useState(''); useEffect(() => { adminFetch<any>('/api/admin/overview?range=7d').then(setData).catch(e => setError(e.message)); }, []); if (error) return <p className={styles.error}>{error}</p>; if (!data) return <p>加载概览中…</p>; const s = data.summary || {}; return <section><h2>数据概览</h2><div className={styles.grid}>{[['总用户',s.totalUsers],['今日新增',s.todayNewUsers],['DAU',s.dau],['WAU',s.wau],['MAU',s.mau],['笔记',s.totalNotes],['聊天',s.totalChats],['AI 成功率',s.aiSuccessRate == null ? null : `${Math.round(s.aiSuccessRate * 100)}%`],['失败富化',s.failedArtifacts]].map(([l,v]) => <MetricCard key={String(l)} label={String(l)} value={v as any} />)}</div><div className={styles.card}><h3>趋势</h3><TrendChart values={(data.timeseries || []).map((x: any) => x.value)} /><p className={styles.muted}>Token 覆盖：{data.tokenCoverage?.rate == null ? '数据积累中' : `${Math.round(data.tokenCoverage.rate * 100)}%`}；成本覆盖：{data.costCoverage?.rate == null ? '数据积累中' : `${Math.round(data.costCoverage.rate * 100)}%`}</p></div></section>; }
