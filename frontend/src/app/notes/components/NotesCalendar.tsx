'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNoteCalendar } from '../hooks/useNoteCalendar';
import { beijingDate, monthGrid, shiftMonth } from '../utils/noteFeed';
import styles from '../NotesWorkspace.module.scss';
export default function NotesCalendar({ userId, version }: { userId: string | null; version: number }) {
  const today = beijingDate();
  const thisMonth = today.slice(0, 7);
  const [selection, setSelection] = useState({ userId, month: thisMonth });
  const month = selection.userId === userId ? selection.month : thisMonth;
  const setMonth = (value: string) => setSelection({ userId, month: value });
  const { data, loading, error, retry } = useNoteCalendar(userId, month, version);
  const counts = new Map(data?.days.map(day => [day.date, day.count]));
  return <div className={styles.calendar}>
    <h2 className={styles.calendarHeading}>记录月历</h2>
    <div className={styles.calendarBody}>
      <div className={styles.monthBar}>
        <strong>{month.replace('-', ' / ')}</strong>
        <button type="button" className={styles.iconButton} aria-label="上个月" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></button>
        <button type="button" className={styles.iconButton} aria-label="下个月" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></button>
      </div>
      {loading ? <p className={styles.calendarStatus} role="status">正在加载统计…</p> : error ? <div className={styles.error} role="alert">{error}<button type="button" className={styles.button} onClick={() => void retry()}>重试月历</button></div> : data ? <>
        <div className={styles.calendarStats}><div><strong>{data.noteCount}</strong><span>{month === thisMonth ? '本月笔记' : '当月笔记'}</span></div><div><strong>{data.recordedDayCount}</strong><span>记录天数</span></div></div>
        <div className={styles.calendarGrid} role="group" aria-label={month + '记录日历'}>
          {['一', '二', '三', '四', '五', '六', '日'].map(day => <span className={styles.weekday} key={day}>{day}</span>)}
          {monthGrid(month).map((day, index) => day ? <span key={day} className={[styles.calendarDay, counts.has(day) ? styles.recordedDay : '', day === today ? styles.today : ''].join(' ')}
            aria-current={day === today ? 'date' : undefined} aria-label={`${Number(day.slice(5, 7))} 月 ${Number(day.slice(8))} 日，${counts.get(day) ?? 0} 篇笔记${day === today ? '，今天' : ''}`} title={`${day}，${counts.get(day) ?? 0} 篇笔记`}>{Number(day.slice(8))}{counts.has(day) && <i aria-hidden="true" />}</span> : <span key={'blank-' + index} />)}
        </div>
      </> : null}
      {month !== thisMonth && <button type="button" className={styles.button} onClick={() => setMonth(thisMonth)}>回到本月</button>}
      <p className={styles.calendarHint}>按北京时间与创建日期统计</p>
    </div>
  </div>;
}
