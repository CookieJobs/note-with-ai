import { useId } from 'react';

import styles from '../admin.module.scss';

type TrendPoint = { day: string; value: number };
type TrendChartProps = {
  points: TrendPoint[];
  label?: string;
};

const formatDate = (day: string): string => {
  const [, month, date] = day.split('-');
  return month && date ? `${Number(month)}/${Number(date)}` : day;
};

export default function TrendChart({ points, label = '每日新增笔记趋势' }: TrendChartProps) {
  const descriptionId = useId();
  if (!points.length) {
    return <p className={styles.chartEmpty}>暂无趋势数据，笔记创建后会在这里按日展示。</p>;
  }

  const highest = Math.max(0, ...points.map((point) => point.value));
  const tickStep = Math.max(1, Math.ceil(highest / 2));
  const ceiling = tickStep * 2;
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const y = (value: number) => 176 - (value / ceiling) * 172;
  const x = (index: number) => `${points.length === 1 ? 50 : index / (points.length - 1) * 100}%`;
  const dateIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartSummary} id={descriptionId}>
        <span>所选范围新增 <strong>{total.toLocaleString('zh-CN')}</strong> 篇</span>
        <span>日均 {(total / points.length).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 篇</span>
      </figcaption>
      <div className={styles.chartPlot}>
        <div className={styles.chartYAxis} aria-hidden="true">
          {[ceiling, tickStep, 0].map((tick) => <span key={tick}>{tick.toLocaleString('zh-CN')}</span>)}
        </div>
        <svg role="img" aria-label={label} aria-describedby={descriptionId} width="100%" height="180">
          {[ceiling, tickStep, 0].map((tick) => (
            <line key={tick} x1="0%" x2="100%" y1={y(tick)} y2={y(tick)} className={styles.chartGrid} />
          ))}
          {points.slice(1).map((point, index) => (
            <line
              key={point.day}
              x1={x(index)}
              y1={y(points[index].value)}
              x2={x(index + 1)}
              y2={y(point.value)}
              className={styles.chartLine}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          ))}
          {points.map((point, index) => (
            <circle key={point.day} cx={x(index)} cy={y(point.value)} r={points.length === 1 ? 4 : 3} className={styles.chartPoint}>
              <title>{point.day}：{point.value} 篇</title>
            </circle>
          ))}
        </svg>
      </div>
      <div className={styles.chartXAxis} aria-hidden="true" style={points.length === 1 ? { justifyContent: 'center' } : undefined}>
        {dateIndexes.map((index) => <span key={points[index].day}>{formatDate(points[index].day)}</span>)}
      </div>
      {total === 0 && <p className={styles.muted}>该范围暂无新增笔记。</p>}
      <details className={styles.chartDetails}>
        <summary>查看每日数据</summary>
        <table aria-label="每日新增笔记数据">
          <thead><tr><th scope="col">日期（上海时间）</th><th scope="col">新增笔记</th></tr></thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.day}><td>{point.day}</td><td>{point.value.toLocaleString('zh-CN')} 篇</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
