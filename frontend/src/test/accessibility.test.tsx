import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AuthPage from '@/app/auth/page';
import MemoryPage from '@/app/memory/page';
import ModernNoteCard from '@/app/notes/components/ModernNoteCard';
import type { Note } from '@/app/notes/hooks/useNotes';
import ProfilePage from '@/app/profile/page';
import ChatHistoryPanel from '@/components/ChatHistoryPanel';
import TopNavigation from '@/components/TopNavigation';

const navigation = vi.hoisted(() => ({
  pathname: '/notes',
  push: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  isAuthenticated: vi.fn(),
  logout: vi.fn(),
}));
const memory = vi.hoisted(() => ({
  confirm: vi.fn().mockResolvedValue(undefined),
  correct: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  generate: vi.fn().mockResolvedValue({ created: 0 }),
  get: vi.fn(),
  getPreference: vi.fn().mockResolvedValue({ noteId: 'note-1', included: true }),
  savePreference: vi.fn().mockResolvedValue({ noteId: 'note-1', included: false }),
}));
const profile = vi.hoisted(() => ({
  feed: vi.fn(),
  stats: vi.fn(),
  trigger: vi.fn(),
  update: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/utils/auth', () => auth);
vi.mock('@/services/memoryService', () => ({
  getMemoryInsights: memory.get,
  generateMemoryInsights: memory.generate,
  confirmMemoryInsight: memory.confirm,
  correctMemoryInsight: memory.correct,
  deleteMemoryInsight: memory.remove,
  getNoteAiPreference: memory.getPreference,
  saveNoteAiPreference: memory.savePreference,
}));
vi.mock('@/services/feedService', () => ({
  getFeed: profile.feed,
  getStats: profile.stats,
  triggerAnalysis: profile.trigger,
}));
vi.mock('@/services/userService', () => ({
  updateProfile: profile.update,
  changePassword: profile.changePassword,
}));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

const note: Note = {
  _id: 'note-1',
  title: '一段足够长的中文笔记标题，用于覆盖窄屏下的真实操作布局。',
  content: '正文', contentText: '正文', contentJson: null, summary: '', concepts: [], keywords: [], recommendCache: null,
  revision: 1, enrichment: { sourceRevision: 1, status: 'ready' },
  createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z',
};

async function expectNoAxeViolations(container: HTMLElement) {
  const result = await axe.run(
    { include: [container], exclude: ['[data-floating-ui-focus-guard]'] },
    { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } },
  );
  expect(result.violations).toEqual([]);
}

function setMobileViewport() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
}

function DrawerFocusHarness() {
  const [isOpen, setIsOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return <>
    <button ref={triggerRef} type="button">打开侧边栏</button>
    <ChatHistoryPanel sessions={[]} currentSessionId="" isClient isOpen={isOpen} onClose={() => setIsOpen(false)} onSessionSelect={vi.fn()} onNewSession={vi.fn()} onDeleteSession={vi.fn()} menuButtonRef={triggerRef} />
  </>;
}

describe('core rendered accessibility states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.lang = 'zh-CN';
    document.title = 'NoteWithAI accessibility fixture';
    navigation.pathname = '/notes';
    auth.getUser.mockReturnValue({ username: 'Ada', email: 'ada@example.com' });
    auth.isAuthenticated.mockReturnValue(true);
    memory.get.mockResolvedValue([{ id: 'memory-1', displayStatement: '你在练习写作', status: 'proposed', confidence: 'tentative', evidence: [] }]);
    profile.feed.mockResolvedValue({
      feed: [{ type: 'rediscover', title: '旧笔记', content: '重新阅读的内容', noteId: 'note-9', reason: '与你的写作主题相关' }],
      profileStatus: 'ready', userProfile: { interests: [{ topic: '写作', score: 0.9 }], summary: '持续记录。' },
    });
    profile.stats.mockResolvedValue({ totalNotes: 3, notesThisMonth: 1, notesThisWeek: 1, streakDays: 1, maxStreak: 1, totalWords: 120, avgWordsPerNote: 40, interestCount: 1, lastAnalyzedAt: null });
    profile.update.mockResolvedValue({});
    profile.changePassword.mockResolvedValue(undefined);
    setMobileViewport();
  });

  it('has no axe violations for navigation and all auth modes', async () => {
    const navigationView = render(<TopNavigation />);
    await screen.findByRole('button', { name: 'Ada' });
    await expectNoAxeViolations(navigationView.container);
    navigationView.unmount();

    const authView = render(<AuthPage />);
    await expectNoAxeViolations(authView.container);
    fireEvent.click(screen.getByRole('tab', { name: '注册' }));
    await expectNoAxeViolations(authView.container);
    fireEvent.click(screen.getByRole('tab', { name: '重置密码' }));
    await expectNoAxeViolations(authView.container);
  });

  it('checks Memory dialogs, the mobile Chat drawer, Profile feed, and note card actions', async () => {
    const memoryView = render(<MemoryPage />);
    fireEvent.click(await screen.findByRole('button', { name: '修改' }));
    await expectNoAxeViolations(document.body);
    fireEvent.keyDown(screen.getByRole('dialog', { name: '用你的话重新表述' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '删除这条记忆' }));
    await screen.findByRole('dialog', { name: '删除这条记忆' });
    await expectNoAxeViolations(document.body);
    fireEvent.keyDown(screen.getByRole('dialog', { name: '删除这条记忆' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    memoryView.unmount();

    const chatView = render(<ChatHistoryPanel sessions={[{ id: 'session-1', title: '旅行计划', messages: [], createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z' }]} currentSessionId="session-1" isClient isOpen onClose={vi.fn()} onSessionSelect={vi.fn()} onNewSession={vi.fn()} onDeleteSession={vi.fn()} />);
    await screen.findByRole('dialog', { name: '聊天记录' });
    await expectNoAxeViolations(document.body);
    chatView.unmount();

    const profileView = render(<ProfilePage />);
    await screen.findByRole('link', { name: '查看笔记：旧笔记' });
    await expectNoAxeViolations(profileView.container);
    profileView.unmount();

    const noteView = render(<ModernNoteCard note={note} onRequestDelete={vi.fn()} updateNote={vi.fn()} onOpenRelated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '笔记操作' }));
    await screen.findByRole('menu');
    await expectNoAxeViolations(document.body);
    noteView.unmount();
  });

  it('keeps focus behavior explicit where axe cannot infer it', async () => {
    const view = render(<DrawerFocusHarness />);
    const drawer = await screen.findByRole('dialog', { name: '聊天记录' });
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: '打开侧边栏' })).toHaveFocus());
    view.unmount();
  });
});
