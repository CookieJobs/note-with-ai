/*
Input: Workspace 唯一真实定期发现控制器
Output: 事前披露、服务端开关、下次可检查时间和重试
Pos: frontend/src/app/inspiration/components
Note: 修改时同步 ../README.md。
*/
'use client';
import { useId } from 'react';
import type { InspirationSettingsController } from '../../../hooks/useInspirationSettings';
import type { InspirationSettings, NoteContextReason } from '../../../services/inspirationService';
import styles from '../inspiration.module.scss';
const contextMessages: Record<NoteContextReason, string> = {
  no_notes: '请先记录一篇笔记，再来研究灵感。',
  summary_pending: '近期笔记的摘要正在准备中，请稍后再试。',
  context_unavailable: '近期笔记缺少可用的标题或摘要。',
};
const statuses: Record<string, string> = {
  completed: '最近一次检查已完成。', no_result: '最近一次检查没有发现新的来源。',
  failed: '最近一次检查暂时未能完成，会在下一个检查周期再试。', cancelled: '最近一次检查因设置关闭而停止。',
};
export function scheduleStatusMessage(settings: InspirationSettings): string {
  if (settings.lastStatus === 'no_result' && settings.lastReason === 'note_context_unavailable') {
    return settings.lastContextReason ? `最近一次检查未开始检索：${contextMessages[settings.lastContextReason]}` : '最近一次检查因笔记缺少可用上下文，未开始检索。';
  }
  return statuses[settings.lastStatus || ''] || '最近一次检查状态已更新。';
}
export default function ScheduledDiscoverySettings({ controller }: { controller: InspirationSettingsController }) {
  const id = useId();
  const { settings, loading, saving, error, refetch, setEnabled } = controller;
  return (
    <section className={styles.scheduledPanel} aria-labelledby={`${id}-title`}>
      <div className={styles.scheduledHeading}>
        <div><h2 id={`${id}-title`}>定期发现</h2><p>从近期主题中寻找新线索，结果会进入灵感历史。</p></div>
        <label className={styles.switchLabel}>
          <span>定期为我寻找灵感</span>
          <input type="checkbox" role="switch" aria-label="定期为我寻找灵感" aria-describedby={`${id}-disclosure`}
            checked={settings?.enabled ?? false} disabled={!settings || loading || saving}
            onChange={(event) => void setEnabled(event.target.checked)} />
        </label>
      </div>
      <p id={`${id}-disclosure`} className={styles.scheduleDisclosure}>
        开启后会使用近期笔记的标题（若有）和短摘要；DeepSeek 接收这些受限元数据，Tavily 仅接收搜索查询。每 24 小时最多尝试一次，结果会进入灵感历史。开启本身不会立即开始研究。
      </p>
      {loading && <p className={styles.scheduleStatus} role="status">正在加载定期发现设置…</p>}
      {saving && <p className={styles.scheduleStatus} role="status">正在保存定期发现设置…</p>}
      {settings?.enabled && settings.nextEligibleAt && <p className={styles.scheduleStatus}>下次可检查：{new Date(settings.nextEligibleAt).toLocaleString()}（当地时间）</p>}
      {settings?.lastStatus && <p className={styles.scheduleStatus}>{scheduleStatusMessage(settings)}</p>}
      {error && <p className={styles.errorMessage} role="alert">{error}</p>}
      {error && !settings && <button type="button" className={styles.loadMore} disabled={loading || saving} onClick={() => void refetch()}>重试加载定期发现设置</button>}
    </section>
  );
}
