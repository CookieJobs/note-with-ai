import { useEffect, useState } from 'react';

import styles from '../admin.module.scss';
import ReasonDialog from '../components/ReasonDialog';
import { adminFetch } from '../lib/adminApi';
import type { NoteDiscoveryEnvironment } from '../lib/contracts';

const endpoint = '/api/admin/ai/note-discovery-billing';
const fields = [
  { key: 'inputPrice', label: '生成模型输入单价' },
  { key: 'outputPrice', label: '生成模型输出单价' },
  { key: 'embeddingPrice', label: '向量模型单价' },
  { key: 'userDaily', label: '每用户每日上限' },
  { key: 'globalDaily', label: '全局每日上限' },
  { key: 'reservation', label: '单次预留上限' },
] as const;
type BillingValues = Record<typeof fields[number]['key'], string>;
type BillingForm = {
  model: string;
  embeddingProvider: string;
  embeddingModel: string;
  enabled: boolean;
  values: BillingValues;
};

export default function NoteDiscoveryBillingForm({ onSaved }: {
  onSaved: (environment: NoteDiscoveryEnvironment) => void;
}) {
  const [billing, setBilling] = useState<BillingForm | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void adminFetch<BillingForm>(endpoint, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setBilling(result); })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '读取计费配置失败');
      });
    return () => controller.abort();
  }, []);

  if (error) return <p role="alert" className={styles.error}>{error}</p>;
  if (!billing) return <p role="status">正在读取计费与预算…</p>;
  return (
    <form onSubmit={(event) => { event.preventDefault(); setConfirm(true); }}>
      <p className={styles.panelDescription}>生成模型 {billing.model} · 向量模型 {billing.embeddingProvider} / {billing.embeddingModel}</p>
      {billing.enabled && <p className={styles.panelDescription}>关闭环境总开关后可以修改计费与预算。</p>}
      <div className={styles.toolbar}>
        {fields.map(({ key, label }, index) => (
          <label key={key} className={styles.field}>
            {label}（{index < 3 ? '元／百万 Token' : '元'}）
            <input
              required
              inputMode="decimal"
              disabled={billing.enabled}
              value={billing.values[key]}
              onChange={(event) => {
                const value = event.target.value;
                setBilling((current) => current && { ...current, values: { ...current.values, [key]: value } });
              }}
            />
          </label>
        ))}
      </div>
      {!billing.enabled && <button className={styles.primaryButton} type="submit">保存计费与预算</button>}
      {confirm && (
        <ReasonDialog
          title="保存笔记发现计费与预算"
          onClose={() => setConfirm(false)}
          onSubmit={async (reason) => {
            const status = await adminFetch<NoteDiscoveryEnvironment>(endpoint, {
              method: 'POST',
              body: JSON.stringify({
                ...billing.values, model: billing.model, embeddingProvider: billing.embeddingProvider,
                embeddingModel: billing.embeddingModel, reason,
              }),
            });
            onSaved(status);
          }}
        />
      )}
    </form>
  );
}
