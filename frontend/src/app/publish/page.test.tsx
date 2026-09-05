import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PublishManagerPage from './page';

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));
vi.mock('../../components/TopNavigation', () => ({ default: () => <div /> }));
vi.mock('../../services/publicationService', () => ({
  listPublications: mockList,
  refreshPublication: vi.fn(),
  revokePublication: vi.fn(),
}));

describe('PublishManagerPage', () => {
  it('shows an active public link and a revoke control', async () => {
    mockList.mockResolvedValue([{ id: 'pub-1', slug: 'a'.repeat(24), title: '公开文章', status: 'active', sourceRevision: 2 }]);
    render(<PublishManagerPage />);
    expect(await screen.findByText('公开文章')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销链接' })).toBeInTheDocument();
  });
});

