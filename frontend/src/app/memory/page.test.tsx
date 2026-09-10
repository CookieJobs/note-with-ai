import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MemoryPage from './page';
import styles from './memory.module.scss';

const memoryStyles = readFileSync('src/app/memory/memory.module.scss', 'utf8');
const semanticVariables = readFileSync('src/styles/_variables.scss', 'utf8');

function blockFor(selector: ':root' | '.dark') {
  const start = semanticVariables.indexOf(`${selector} {`);
  const end = semanticVariables.indexOf('\n}', start);

  return semanticVariables.slice(start, end);
}

function tokenValue(block: string, token: string) {
  const value = block.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1];

  if (!value) throw new Error(`Missing ${token}`);
  return value;
}

function parseHex(value: string) {
  const hex = value.match(/#([\da-f]{6})/i)?.[1];
  if (!hex) throw new Error(`Expected a hexadecimal color, received ${value}`);

  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ] as const;
}

function composite(foreground: readonly number[], background: readonly number[], opacity: number) {
  return foreground.map((channel, index) => channel * opacity + background[index] * (1 - opacity));
}

function contrastRatio(first: readonly number[], second: readonly number[]) {
  const luminance = (color: readonly number[]) => color.reduce((total, channel, index) => {
    const normalized = channel / 255;
    const linear = normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;

    return total + [0.2126, 0.7152, 0.0722][index] * linear;
  }, 0);
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);

  return (lighter + 0.05) / (darker + 0.05);
}

const { mockConfirm, mockCorrect, mockDelete, mockGenerate, mockGet } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockCorrect: vi.fn(),
  mockDelete: vi.fn(),
  mockGenerate: vi.fn(),
  mockGet: vi.fn(),
}));
vi.mock('../../components/TopNavigation', () => ({ default: () => <div /> }));
vi.mock('../../services/memoryService', () => ({
  getMemoryInsights: mockGet,
  generateMemoryInsights: mockGenerate,
  confirmMemoryInsight: mockConfirm,
  correctMemoryInsight: mockCorrect,
  deleteMemoryInsight: mockDelete,
}));

describe('MemoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue({ created: 0 });
    mockGet.mockResolvedValue([{
      id: 'memory-1', displayStatement: '你在练习写作', status: 'proposed', confidence: 'tentative',
      evidence: [{ noteId: 'note-1', noteRevision: 2, excerpt: '我想持续练习写作', capturedAt: '2026-09-01T00:00:00.000Z' }],
    }]);
  });

  it('reveals an evidence link and asks for deletion confirmation', async () => {
    render(<MemoryPage />);
    expect(await screen.findByText('你在练习写作')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看依据' }));
    expect(screen.getByRole('link', { name: '查看原文' })).toHaveAttribute('href', '/notes?highlight=note-1');
    fireEvent.click(screen.getByRole('button', { name: '删除这条记忆' }));
    expect(screen.getByRole('dialog', { name: '删除这条记忆' })).toBeInTheDocument();
  });

  it('keeps the confirmation action distinct on semantic light and dark cards', async () => {
    render(<MemoryPage />);

    const confirm = await screen.findByRole('button', { name: '这是准确的' });

    expect(confirm).toHaveClass('bg-primary');
    expect(confirm).toHaveClass(styles.memoryPrimaryAction);
    expect(memoryStyles).toMatch(/\.card\s*\{[^}]*background:\s*var\(--color-surface-raised\)/);
    expect(memoryStyles).toMatch(/\.memoryPrimaryAction\s*\{[^}]*background:\s*var\(--color-action-primary\)/);
    expect(memoryStyles).toMatch(/\.memoryPrimaryAction\s*\{[^}]*color:\s*var\(--color-text-inverse\)/);
    expect(memoryStyles).toMatch(/&:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--color-action-primary-hover\)/);
    expect(memoryStyles).toMatch(/&:focus-visible\s*\{[^}]*box-shadow:\s*var\(--focus-ring\)/);
    expect(memoryStyles).toMatch(/&:disabled\s*\{[^}]*background:\s*var\(--color-action-primary-active\)/);
    expect(memoryStyles).toMatch(/&\[aria-busy=['"]true['"]\]\s*\{[^}]*background:\s*var\(--color-action-primary-hover\)/);
    const disabledOpacity = Number(memoryStyles.match(/&:disabled\s*\{[^}]*opacity:\s*([\d.]+)/)?.[1]);
    expect(disabledOpacity).toBeGreaterThan(0);

    [blockFor(':root'), blockFor('.dark')].forEach((tokens) => {
      const card = parseHex(tokenValue(tokens, '--color-surface-raised'));
      const foreground = parseHex(tokenValue(tokens, '--color-text-inverse'));

      [
        tokenValue(tokens, '--color-action-primary'),
        tokenValue(tokens, '--color-action-primary-hover'),
      ].forEach((action) => {
        const actionColor = parseHex(action);
        expect(contrastRatio(actionColor, card)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(foreground, actionColor)).toBeGreaterThanOrEqual(4.5);
      });

      const disabledAction = composite(
        parseHex(tokenValue(tokens, '--color-action-primary-active')),
        card,
        disabledOpacity,
      );
      const disabledForeground = composite(foreground, card, disabledOpacity);
      expect(contrastRatio(disabledAction, card)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(disabledForeground, disabledAction)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('opens the edit form as a labelled modal', async () => {
    render(<MemoryPage />);

    fireEvent.click(await screen.findByRole('button', { name: '修改' }));

    const dialog = await screen.findByRole('dialog', { name: '用你的话重新表述' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
  });

  it('closes the edit modal with Escape without saving and returns focus to its trigger', async () => {
    render(<MemoryPage />);

    const edit = await screen.findByRole('button', { name: '修改' });
    fireEvent.click(edit);
    fireEvent.keyDown(await screen.findByRole('dialog', { name: '用你的话重新表述' }), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockCorrect).not.toHaveBeenCalled();
    expect(edit).toHaveFocus();
  });

  it('closes the deletion modal with Escape without deleting the memory', async () => {
    render(<MemoryPage />);

    fireEvent.click(await screen.findByRole('button', { name: '删除这条记忆' }));
    fireEvent.keyDown(await screen.findByRole('dialog', { name: '删除这条记忆' }), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('explains when memory generation cannot complete instead of failing silently', async () => {
    mockGet.mockResolvedValue([]);
    mockGenerate.mockRejectedValue(new Error('request failed'));

    render(<MemoryPage />);
    fireEvent.click(await screen.findByRole('button', { name: '从我的笔记整理记忆' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法整理记忆，请稍后再试。');
  });
});
