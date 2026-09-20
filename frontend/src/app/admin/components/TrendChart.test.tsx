import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TrendChart from './TrendChart';

describe('TrendChart', () => {
  it('shows a visible marker and dated value for a single day', () => {
    render(<TrendChart points={[{ day: '2026-09-01', value: 4 }]} />);

    const chart = screen.getByRole('img', { name: '每日新增笔记趋势' });
    expect(chart.querySelector('circle')).toHaveAttribute('cx', '50%');
    expect(Number(chart.querySelector('circle')?.getAttribute('r'))).toBeGreaterThan(0);
    expect(chart).toHaveTextContent('2026-09-01：4 篇');
    expect(screen.getByText('9/1')).toBeInTheDocument();
  });

  it('keeps zero activity as dated zeroes rather than missing data', () => {
    render(<TrendChart points={[
      { day: '2026-09-01', value: 0 },
      { day: '2026-09-02', value: 0 },
    ]} />);

    expect(screen.getByText('该范围暂无新增笔记。')).toBeInTheDocument();
    fireEvent.click(screen.getByText('查看每日数据'));
    const rows = within(screen.getByRole('table', { name: '每日新增笔记数据' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('2026-09-01');
    expect(rows[1]).toHaveTextContent('0 篇');
    expect(rows[2]).toHaveTextContent('2026-09-02');
    expect(rows[2]).toHaveTextContent('0 篇');
  });

  it('shows missing data without inventing dates or an all-zero trend', () => {
    render(<TrendChart points={[]} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('该范围暂无新增笔记。')).not.toBeInTheDocument();
    expect(screen.getByText(/暂无趋势数据/)).toBeInTheDocument();
  });
});
