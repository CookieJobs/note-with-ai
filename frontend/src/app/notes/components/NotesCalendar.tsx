'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNoteCalendar } from '../hooks/useNoteCalendar';
import { beijingDate, monthGrid, shiftMonth } from '../utils/noteFeed';
import styles from '../NotesWorkspace.module.scss';

const heatLevels = [
  { minimum: 0, label: '0 篇' },
  { minimum: 1, label: '1 篇' },
  { minimum: 2, label: '2 至 3 篇' },
  { minimum: 4, label: '4 至 6 篇' },
  { minimum: 7, label: '7 篇及以上' },
];

export default function NotesCalendar({ userId, version }: { userId: string | null; version: number }) {
  const today = beijingDate();
  const thisMonth = today.slice(0, 7);
  const [selection, setSelection] = useState({ userId, month: thisMonth });
  const month = selection.userId === userId ? selection.month : thisMonth;
  const setMonth = (value: string) => setSelection({ userId, month: value });
  const { data, loading, error, retry } = useNoteCalendar(userId, month, version);
  const counts = new Map<string, number>(data?.days.map(day => [day.date, day.count]));
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
          {monthGrid(month).map((day, index) => {
            if (!day) return <span key={'blank-' + index} aria-hidden="true" />;
            const count = counts.get(day) ?? 0;
            const level = heatLevels.reduce((level, { minimum }, index) => count >= minimum ? index : level, 0);
            const dayNumber = Number(day.slice(8));
            const isToday = day === today;
            return <span key={day} className={`${styles.calendarDay} ${styles.heatCell}`} data-heat-level={level}
              role="img" aria-current={isToday ? 'date' : undefined}
              aria-label={`${Number(day.slice(5, 7))} 月 ${dayNumber} 日，${count} 篇笔记${isToday ? '，今天' : ''}`}
              title={`${day}，${count} 篇笔记`}>{dayNumber}</span>;
          })}
        </div>
        <div className={styles.calendarLegend} role="img" aria-label={`笔记数由少到多：${heatLevels.map(({ label }) => label).join('、')}`}>
          <span>少</span>
          {heatLevels.map(({ label }, level) => <span key={label} className={`${styles.legendSwatch} ${styles.heatCell}`} data-heat-level={level} title={label} />)}
          <span>多</span>
        </div>
      </> : null}
      {month !== thisMonth && <button type="button" className={styles.button} onClick={() => setMonth(thisMonth)}>回到本月</button>}
      <p className={styles.calendarHint}>按北京时间与创建日期统计</p>
    </div>
  </div>;
}
