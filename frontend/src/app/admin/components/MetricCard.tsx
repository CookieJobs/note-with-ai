import styles from '../admin.module.scss';
export default function MetricCard({ label, value }: { label: string; value: string | number | null }) { return <div className={styles.card}><span>{label}</span><strong>{value ?? '数据积累中'}</strong></div>; }
