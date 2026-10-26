import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SourceExcerpt from './SourceExcerpt';

describe('source excerpt disclosure', () => {
  it('keeps the original image URL accessible when cleanup leaves no preview words', () => {
    const snippet = '![](https://example.com/full-image.jpg)';
    const { container } = render(<SourceExcerpt snippet={snippet} />);
    fireEvent.click(screen.getByRole('button', { name: '展开来源摘录' }));
    expect(screen.getByText(snippet)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
  it('reveals the exact original excerpt and collapses it again', () => {
    const snippet = '# 原始标题\n' + '完整来源文字'.repeat(50);
    render(<SourceExcerpt snippet={snippet} />);
    const toggle = screen.getByRole('button', { name: '展开来源摘录' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const content = document.getElementById(
      toggle.getAttribute('aria-controls')!,
    );
    expect(content?.textContent).not.toBe(snippet);
    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: '收起来源摘录' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(content?.textContent).toBe(snippet);
    fireEvent.click(screen.getByRole('button', { name: '收起来源摘录' }));
    expect(content?.textContent).not.toBe(snippet);
  });

  it('keeps each source expansion independent', () => {
    render(
      <>
        <SourceExcerpt snippet={'甲'.repeat(230)} />
        <SourceExcerpt snippet={'乙'.repeat(230)} />
      </>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: '展开来源摘录' })[0]);
    expect(
      screen.getAllByRole('button', { name: '收起来源摘录' }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: '展开来源摘录' }),
    ).toHaveLength(1);
  });

  it('renders source HTML safely as text and omits blank content', () => {
    const { container, rerender } = render(
      <SourceExcerpt snippet={'<img src=x onerror="alert(1)">'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.getByText('<img src=x onerror="alert(1)">'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<SourceExcerpt snippet="  " />);
    expect(container).toBeEmptyDOMElement();
  });
});
