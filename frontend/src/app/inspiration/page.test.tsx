import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import InspirationPage from './page';

const { mockGetItems, mockGetSettings, mockSaveSettings } = vi.hoisted(() => ({
  mockGetItems: vi.fn(), mockGetSettings: vi.fn(), mockSaveSettings: vi.fn(),
}));

vi.mock('../../components/TopNavigation', () => ({ default: () => <div /> }));
vi.mock('../../services/inspirationService', () => ({
  getInspirations: mockGetItems,
  getInspirationSettings: mockGetSettings,
  saveInspirationSettings: mockSaveSettings,
  getInspirationJob: vi.fn(), requestInspiration: vi.fn(), updateInspirationStatus: vi.fn(),
}));

describe('InspirationPage', () => {
  beforeEach(() => {
    mockGetItems.mockResolvedValue([]);
    mockGetSettings.mockResolvedValue({ proactiveEnabled: false });
    mockSaveSettings.mockResolvedValue({ proactiveEnabled: true });
  });

  it('keeps proactive inspiration off by default and requires explicit opt-in', async () => {
    render(<InspirationPage />);
    const control = await screen.findByRole('checkbox', { name: '允许主动寻找灵感' });
    expect(control).not.toBeChecked();
    fireEvent.click(control);
    expect(mockSaveSettings).toHaveBeenCalledWith(true);
  });
});
