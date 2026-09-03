import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../lib/adminApi';
import type { Audit, ListResponse } from '../lib/contracts';
import AuditPage from './page';

const audit: Audit = {
  id: 'audit-1',
  requestId: 'request-1',
  action: 'ai.artifact_retry',
  status: 'pending',
  targetType: 'Note',
  targetId: 'note-1',
  actor: { id: '507f1f77bcf86cd799439011', displayName: 'Operator' },
  metadata: {
    reason: 'retry requested',
    retryStatus: 'saved',
    secret: 'must-never-render',
    nested: { content: 'also hidden' },
  },
  errorCode: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const result = (
  items: Audit[] = [audit],
  page = 1,
  hasNext = false,
): ListResponse<Audit> => ({
  items,
  pagination: { page, limit: 20, total: hasNext ? 21 : items.length, hasNext },
});

function requestedUrl(call: unknown[]): URL {
  return new URL(String(call[0]), 'http://localhost');
}

describe('AuditPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('submits actor, action, status, and date filters and preserves them through pagination', async () => {
    const fetch = vi.spyOn(api, 'adminFetch').mockImplementation((url) => (
      Promise.resolve(String(url).includes('page=2') ? result([], 2) : result([audit], 1, true))
    ));
    render(<AuditPage />);
    await screen.findByText('Operator');

    fireEvent.change(screen.getByLabelText('操作者筛选'), { target: { value: audit.actor.id } });
    fireEvent.change(screen.getByLabelText('动作筛选'), { target: { value: 'ai.artifact_retry' } });
    fireEvent.change(screen.getByLabelText('审计状态筛选'), { target: { value: 'failed' } });
    fireEvent.change(screen.getByLabelText('审计开始日期'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('审计结束日期'), { target: { value: '2026-09-01' } });
    const initialCalls = fetch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    await waitFor(() => expect(fetch.mock.calls.length).toBe(initialCalls + 1));

    const filtered = fetch.mock.calls.find(([url]) => String(url).includes('status=failed'))!;
    expect(Object.fromEntries(requestedUrl(filtered).searchParams)).toEqual({
      page: '1',
      limit: '20',
      actorId: audit.actor.id!,
      action: 'ai.artifact_retry',
      status: 'failed',
      from: '2026-08-01',
      to: '2026-09-01',
    });

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(true));
    const pageTwo = fetch.mock.calls.find(([url]) => String(url).includes('page=2'))!;
    expect(requestedUrl(pageTwo).searchParams.get('actorId')).toBe(audit.actor.id);
  });

  it('renders only hard-coded safe metadata and makes pending uncertainty explicit', async () => {
    vi.spyOn(api, 'adminFetch').mockResolvedValue(result());
    render(<AuditPage />);

    expect(await screen.findByText('reason: retry requested')).toBeInTheDocument();
    expect(screen.getByText('retryStatus: saved')).toBeInTheDocument();
    expect(screen.getByText('pending（状态待人工确认）')).toBeInTheDocument();
    expect(screen.queryByText(/must-never-render/)).not.toBeInTheDocument();
    expect(screen.queryByText(/also hidden/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑|删除/ })).not.toBeInTheDocument();
  });

  it('renders loading, error recovery, and empty states', async () => {
    const fetch = vi.spyOn(api, 'adminFetch')
      .mockRejectedValueOnce(new Error('审计不可用'))
      .mockResolvedValueOnce(result([]));
    render(<AuditPage />);

    expect(screen.getByText('加载审计中…')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('审计不可用');
    fireEvent.click(screen.getByRole('button', { name: '重新加载审计' }));
    expect(await screen.findByText('暂无审计记录')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
