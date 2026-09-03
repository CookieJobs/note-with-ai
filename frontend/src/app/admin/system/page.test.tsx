import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../lib/adminApi';
import type { SystemHealth } from '../lib/contracts';
import SystemPage from './page';

const healthy: SystemHealth = {
  mongo: { readyState: 'connected' },
  uptimeSeconds: 42,
  applicationVersion: '1.2.3',
  failedArtifacts: 0,
  aiSuccessRate24h: 0.98,
};

describe('SystemPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows loading then a healthy label using only safe response fields', async () => {
    let resolveHealth!: (value: SystemHealth) => void;
    vi.spyOn(api, 'adminFetch').mockImplementation(
      () => new Promise((resolve) => { resolveHealth = resolve as typeof resolveHealth; }),
    );
    render(<SystemPage />);
    expect(screen.getByText('加载系统状态中…')).toBeInTheDocument();

    resolveHealth({ ...healthy, secret: 'must-never-render' } as SystemHealth);
    expect(await screen.findByText('健康')).toHaveAttribute('role', 'status');
    expect(screen.getByText('connected')).toBeInTheDocument();
    expect(screen.queryByText('must-never-render')).not.toBeInTheDocument();
  });

  it('labels non-connected states as degraded and null success as accumulating', async () => {
    vi.spyOn(api, 'adminFetch').mockResolvedValue({
      ...healthy,
      mongo: { readyState: 'connecting' },
      aiSuccessRate24h: null,
    });
    render(<SystemPage />);

    expect(await screen.findByText('降级')).toHaveAttribute('role', 'status');
    expect(screen.getByText('数据积累中')).toBeInTheDocument();
  });

  it('shows an error and recovers through an explicit retry', async () => {
    vi.spyOn(api, 'adminFetch')
      .mockRejectedValueOnce(new Error('健康接口不可用'))
      .mockResolvedValueOnce(healthy);
    render(<SystemPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('健康接口不可用');
    fireEvent.click(screen.getByRole('button', { name: '重新加载系统状态' }));
    expect(await screen.findByText('健康')).toHaveAttribute('role', 'status');
  });
});
