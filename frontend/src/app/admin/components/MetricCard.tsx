import styles from '../admin.module.scss';

type MetricCardProps = {
  label: string;
  value: string | number | null;
  hint?: string;
  tone?: 'default' | 'warning';
};

export default function MetricCard({ label, value, hint, tone = 'default' }: MetricCardProps) {
  return (
    <div className={`${styles.metric} ${tone === 'warning' ? styles.metricWarning : ''}`}>
      <span className={styles.metricLabel}>{label}</span>
      <strong className={styles.metricValue}>
        {typeof value === 'number' ? value.toLocaleString('zh-CN') : value ?? '数据积累中'}
      </strong>
      {hint && <span className={styles.metricHint}>{hint}</span>}
    </div>
  );
}
