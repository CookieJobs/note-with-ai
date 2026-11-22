import styles from '../admin.module.scss';
import type { NoteDiscoveryEnvironment } from '../lib/contracts';

export default function NoteDiscoveryEnvironmentStatus({ environment }: { environment: NoteDiscoveryEnvironment }) {
  if (!environment.enabled) {
    return <span className={`${styles.statusBadge} ${styles.statusNeutral}`}>环境总开关已关闭</span>;
  }
  if (!environment.runnable) {
    return <span className={`${styles.statusBadge} ${styles.statusWarning}`}>运行配置待完善</span>;
  }
  return <span className={`${styles.statusBadge} ${styles.statusGood}`}>运行配置已就绪</span>;
}
