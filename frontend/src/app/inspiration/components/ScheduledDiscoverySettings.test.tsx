import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ScheduledDiscoverySettings from './ScheduledDiscoverySettings';
import type { InspirationSettingsController } from '../../../hooks/useInspirationSettings';
const controller = (): InspirationSettingsController => ({ settings: { enabled: false, consentedAt: null, nextEligibleAt: null, lastAttemptAt: null, lastStatus: null, lastReason: null, lastContextReason: null }, loading: false, saving: false, error: null, refetch: vi.fn(), setEnabled: vi.fn() });
describe('ScheduledDiscoverySettings', () => {
  it('shows the complete disclosure before consent and submits through its supplied controller', () => {
    const value = controller(); render(<ScheduledDiscoverySettings controller={value} />);
    expect(screen.getByText(/DeepSeek 接收这些受限元数据，Tavily 仅接收搜索查询/)).toBeInTheDocument();
    expect(screen.getByText(/每 24 小时最多尝试一次/)).toHaveTextContent('开启本身不会立即开始研究');
    fireEvent.click(screen.getByRole('switch', { name: '定期为我寻找灵感' }));
    expect(value.setEnabled).toHaveBeenCalledWith(true); expect(screen.getByRole('switch')).not.toBeChecked();
  });
  it('uses server time as eligibility and explains unavailable context without claiming retrieval ran', () => {
    const value = controller(); value.settings = { ...value.settings!, enabled: true, nextEligibleAt: '2026-10-26T00:00:00Z', lastStatus: 'no_result', lastReason: 'note_context_unavailable', lastContextReason: 'summary_pending' };
    render(<ScheduledDiscoverySettings controller={value} />);
    expect(screen.getByText(/下次可检查/)).toHaveTextContent('当地时间');
    expect(screen.getByText(/未开始检索：近期笔记的摘要正在准备中/)).toBeInTheDocument();
    expect(screen.queryByText(/已同意/)).not.toBeInTheDocument();
  });
  it('disables unavailable or pending settings and exposes a retry after a failed load', () => {
    const value = controller(); value.settings = null; value.error = '暂时无法加载定期发现设置。';
    render(<ScheduledDiscoverySettings controller={value} />);
    expect(screen.getByRole('switch')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重试加载定期发现设置' })); expect(value.refetch).toHaveBeenCalled();
  });
});
