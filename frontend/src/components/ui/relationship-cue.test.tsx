import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RelationshipCue } from './relationship-cue';

describe('RelationshipCue', () => {
  it('expresses a relationship in text while keeping its connector decorative', () => {
    const { container } = render(
      <RelationshipCue
        sourceLabel="写作习惯"
        targetLabel="原始笔记"
        kind="依据"
        explanation="这条理解可以回到原文核对。"
        href="/notes?highlight=note-1"
      />,
    );

    expect(screen.getByText('写作习惯')).toBeInTheDocument();
    expect(screen.getByText('原始笔记')).toBeInTheDocument();
    expect(screen.getByText('依据')).toBeInTheDocument();
    expect(screen.getByText('这条理解可以回到原文核对。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /原始笔记/ })).toHaveAttribute(
      'href',
      '/notes?highlight=note-1',
    );
    expect(container.querySelector('[data-relationship-line]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(container.querySelector('[data-relationship-node]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
