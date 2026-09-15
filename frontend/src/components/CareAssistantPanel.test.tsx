import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CareAssistantPanel from './CareAssistantPanel';

const authFetch = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock('@/utils/auth', () => ({ authFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

describe('CareAssistantPanel', () => {
  beforeEach(() => {
    authFetch.mockResolvedValue({
      json: async () => ({
        data: { noteId: null, noteTitle: '', snippet: '', aiOpening: '今天想记录什么？' },
      }),
    });
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('exposes the conversation CTA as a 44px button instead of making the card interactive', async () => {
    const onSend = vi.fn();
    render(<CareAssistantPanel onInsert={vi.fn()} onSend={onSend} cacheKey="care-panel-test" />);

    const cta = await screen.findByRole('button', { name: '点击开始对话' });
    expect(cta).toHaveClass('h-11');

    fireEvent.click(screen.getByText('今天想记录什么？'));
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(cta);
    expect(onSend).toHaveBeenCalledWith('今天想记录什么？', expect.objectContaining({ aiOpening: '今天想记录什么？' }));
  });
});
