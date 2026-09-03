import styles from '../admin.module.scss';

type MetricCardProps = {
  label: string;
  value: string | number | null;
};

export default function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className={styles.card}>
      <span>{label}</span>
      <strong>{value ?? '数据积累中'}</strong>
    </div>
  );
}
