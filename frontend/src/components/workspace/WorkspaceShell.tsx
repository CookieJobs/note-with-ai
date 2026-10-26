/*
Input: 普通页面、真实账户、最近笔记和未读灵感数
Output: 持续挂载的侧栏工作区、上下文设置及编辑保护弹窗
Pos: frontend/src/components/workspace
Note: 修改时同步本目录 README。
*/
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { BookOpen, ChevronDown, FileText, LogOut, MessageCircle, PanelLeft, Plus, Settings, Sparkles, UserRound } from 'lucide-react';
import { getUser, logout, type User } from '../../utils/auth';
import { getUnviewedInspirationCount } from '../../services/inspirationService';
import { WorkspaceContext, type WorkspaceAccountDialogKind, type WorkspaceChatNavigation, type WorkspaceSettingsTab } from './WorkspaceContext';
import { useWorkspaceNavigation } from './useWorkspaceNavigation';
import { useWorkspacePreferences } from './useWorkspacePreferences';
import { useWorkspaceRecentNotes } from './useWorkspaceRecentNotes';
import WorkspaceSettings from './WorkspaceSettings';
import ChatHistoryPanel from '../ChatHistoryPanel';
import WorkspaceAccountDialogs from '../../app/profile/components/WorkspaceAccountDialogs';
import { useInspirationSettings } from '../../hooks/useInspirationSettings';
import { resolveAvatarDisplay } from '../../app/profile/avatarPresets';
import styles from './Workspace.module.scss';

function WorkspaceAvatar({ user }: { user: User | null }) {
  const display = resolveAvatarDisplay(user?.avatar, user?.username || user?.email || 'N');
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <span className={styles.avatar}>{display.src && failedSource !== display.src ? <img src={display.src} alt="" onError={() => setFailedSource(display.src || null)} /> : display.initials}</span>;
}

const links = [{ href: '/notes', label: '笔记', Icon: FileText }, { href: '/chat', label: 'AI 对话', Icon: MessageCircle }, { href: '/inspiration', label: '灵感', Icon: Sparkles }];

export default function WorkspaceShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const navigation = useWorkspaceNavigation();
  const { preferences, setPreferences, storageError, theme } = useWorkspacePreferences();
  const [user, setUser] = useState<User | null>(null);
  const { recentNotes, setRecentNotes, status: recentStatus, retry: retryRecentNotes } = useWorkspaceRecentNotes(user?.id ?? null, pathname);
  const [count, setCount] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<WorkspaceSettingsTab>('appearance');
  const [accountDialog, setAccountDialog] = useState<WorkspaceAccountDialogKind | null>(null);
  const accountDialogKindRef = useRef<WorkspaceAccountDialogKind | null>(null);
  const [chatNavigation, setChatNavigation] = useState<WorkspaceChatNavigation | null>(null);
  const chatRegistration = useRef<{ value: WorkspaceChatNavigation } | null>(null);
  const accountDialogFocus = useRef<HTMLElement | null>(null);
  const userRef = useRef(user); userRef.current = user;
  const inspirationSettings = useInspirationSettings(user?.id);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const accountRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const restoreSettingsFocus = useRef<HTMLElement | null>(null);

  useEffect(() => { setUser(getUser()); }, [pathname, settingsOpen]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 980px)');
    const update = () => { setNarrow(query.matches); if (!query.matches) setDrawerOpen(false); };
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const refresh = () => { void getUnviewedInspirationCount().then(value => { if (active) setCount(value); }).catch(() => undefined); };
    refresh(); const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('inspiration-count-changed', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('inspiration-count-changed', refresh); };
  }, [user?.id]);
  useEffect(() => {
    if (!accountOpen) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountOpen(false); accountRef.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (!accountMenuRef.current?.contains(event.target as Node)) setAccountOpen(false); };
    document.addEventListener('keydown', dismiss); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', outside); };
  }, [accountOpen]);
  useEffect(() => {
    const dialog = confirmRef.current;
    if (navigation.pending && dialog && !dialog.open) dialog.showModal();
    else if (!navigation.pending && dialog?.open) dialog.close();
  }, [navigation.pending]);
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const sidebar = sidebarRef.current;
    const focused = document.activeElement as HTMLElement | null;
    sidebar?.querySelector<HTMLElement>('button')?.focus();
    const handle = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { setDrawerOpen(false); focused?.focus(); }
      if (event.key !== 'Tab' || !sidebar) return;
      const elements = Array.from(sidebar.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')).filter(item => item.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); if (focused?.isConnected) focused.focus(); };
  }, [drawerOpen]);

  const { navigate, requestAction, registerEditor } = navigation;
  const registerChatNavigation = useCallback((value: WorkspaceChatNavigation) => {
    const registration = { value };
    chatRegistration.current = registration; setChatNavigation(value);
    return () => { if (chatRegistration.current === registration) { chatRegistration.current = null; setChatNavigation(null); } };
  }, []);
  const openSettings = useCallback((tab: WorkspaceSettingsTab = 'appearance') => {
    restoreSettingsFocus.current = accountRef.current; setSettingsTab(tab); setAccountOpen(false); setSettingsOpen(true);
  }, []);
  const openAccountDialog = useCallback((kind: WorkspaceAccountDialogKind) => {
    const open = () => {
      if (accountDialogKindRef.current) return;
      accountDialogKindRef.current = kind;
      accountDialogFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : accountRef.current;
      setAccountOpen(false); setAccountDialog(kind);
    };
    // Changing the password ends the login session, so resolve any note draft first.
    if (kind === 'password') requestAction(open);
    else open();
  }, [requestAction]);
  const updateAccount = useCallback((updated: User) => {
    const current = userRef.current;
    // Another tab may have switched/cleared the shared identity during this save.
    const persisted = getUser();
    if (persisted?.id !== current?.id) {
      userRef.current = persisted; setUser(persisted);
      return;
    }
    if (!current || current.id !== updated.id) return;
    const next = { ...current, ...updated };
    userRef.current = next; setUser(next);
    try { localStorage.setItem('user', JSON.stringify(next)); } catch { /* The server save remains valid if local cache is unavailable. */ }
  }, []);
  const context = useMemo(() => ({ navigate, requestAction, registerEditor, setRecentNotes, user, openSettings, openAccountDialog, registerChatNavigation, inspirationSettings }), [navigate, requestAction, registerEditor, setRecentNotes, user, openSettings, openAccountDialog, registerChatNavigation, inspirationSettings]);
  const closeSettings = () => { setSettingsOpen(false); };
  const interceptLink = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
    const link = event.target.closest('a');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || link.getAttribute('href')?.startsWith('#')) return;
    event.preventDefault(); navigate(`${url.pathname}${url.search}${url.hash}`); setDrawerOpen(false);
  };
  const label = links.find(link => pathname.startsWith(link.href))?.label || '个人页面';

  return <WorkspaceContext.Provider value={context}>
    <div className={styles.root} data-workspace="" data-theme={theme} data-reading-size={preferences.readingSize} data-reduce-motion={preferences.reduceMotion || undefined} data-collapsed={preferences.collapsed} data-drawer-open={drawerOpen} onClick={interceptLink}>
      <a className={styles.skip} href="#workspace-content">跳到主要内容</a>
      {drawerOpen && <button type="button" className={styles.scrim} aria-label="关闭侧栏" onClick={() => setDrawerOpen(false)} />}
      <aside className={styles.sidebar} ref={sidebarRef} aria-label="工作区侧栏" aria-hidden={narrow && !drawerOpen || undefined} role={narrow && drawerOpen ? 'dialog' : undefined} aria-modal={narrow && drawerOpen || undefined}>
        <div className={styles.brandRow}><a href="/notes" className={styles.brand} aria-label="NoteWithAI 笔记首页"><span className={styles.brandMark}><BookOpen size={19} strokeWidth={1.75} /></span><span className={styles.expandedLabel}>NoteWithAI</span></a><button type="button" className={`${styles.iconButton} ${styles.collapse}`} aria-label="收起侧栏" onClick={() => { setPreferences(previous => ({ ...previous, collapsed: true })); setDrawerOpen(false); }}><PanelLeft size={18} /></button></div>
        {pathname.startsWith('/chat') ? <button type="button" className={styles.newNote} aria-label="开启新对话" disabled={!chatNavigation} onClick={() => { void chatNavigation?.onNewSession(); setDrawerOpen(false); }}><Plus size={18} strokeWidth={1.75} /><span className={styles.expandedLabel}>新对话</span></button> : <a href="/notes?compose=1" className={styles.newNote}><Plus size={18} strokeWidth={1.75} /><span className={styles.expandedLabel}>新建笔记</span></a>}
        <nav aria-label="主导航" className={styles.mainNav}>{links.map(({ href, label: itemLabel, Icon }) => <a key={href} href={href} title={itemLabel} aria-label={itemLabel} aria-current={pathname.startsWith(href) ? 'page' : undefined}><Icon size={18} strokeWidth={1.75} /><span className={styles.expandedLabel}>{itemLabel}</span>{href === '/inspiration' && count > 0 && <span className={styles.badge} aria-label={`${count} 条新灵感`}>{count > 99 ? '99+' : count}</span>}</a>)}</nav>
        {pathname.startsWith('/chat') ? <section className={`${styles.chatHistory} ${styles.expandedLabel}`} aria-label="对话历史">{chatNavigation ? <ChatHistoryPanel embedded {...chatNavigation} onSessionSelect={id => { chatNavigation.onSessionSelect(id); setDrawerOpen(false); }} onNewSession={() => { void chatNavigation.onNewSession(); setDrawerOpen(false); }} onClose={() => setDrawerOpen(false)} /> : <p>正在加载对话历史…</p>}</section> : <section className={`${styles.recent} ${styles.expandedLabel}`} aria-label="最近笔记"><h2>最近笔记</h2>{recentNotes.length ? <div>{recentNotes.map(note => <a key={note.id} href={note.href} title={note.title}>{note.title}</a>)}</div> : recentStatus === 'error' ? <><p role="alert">最近笔记加载失败。</p><button type="button" className={styles.button} aria-label="重试最近笔记" onClick={retryRecentNotes}>重试</button></> : <p>{recentStatus === 'ready' ? '还没有笔记。' : recentStatus === 'idle' ? '登录后查看最近笔记。' : '正在加载最近笔记…'}</p>}</section>}
        <div className={styles.accountArea} ref={accountMenuRef}>
          {accountOpen && <div className={styles.accountMenu} id="workspace-account-menu"><div className={styles.accountDetails}><strong>{user?.username || '我的账户'}</strong><span>{user?.email}</span></div><a href="/profile" onClick={() => setAccountOpen(false)}><UserRound size={17} />个人页面</a><button type="button" onClick={() => openSettings()}><Settings size={17} />设置</button><button type="button" onClick={() => { setAccountOpen(false); requestAction(logout); }}><LogOut size={17} />退出登录</button></div>}
          <button ref={accountRef} type="button" className={styles.accountButton} aria-label="账户菜单" aria-expanded={accountOpen} aria-controls="workspace-account-menu" onClick={() => setAccountOpen(value => !value)}><WorkspaceAvatar user={user} /><span className={`${styles.accountCopy} ${styles.expandedLabel}`}><strong>{user?.username || '我的账户'}</strong><small>个人工作区</small></span><ChevronDown size={15} className={styles.expandedLabel} /></button>
        </div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}><button type="button" className={`${styles.iconButton} ${styles.expand}`} aria-label="展开侧栏" onClick={() => { if (window.matchMedia('(max-width: 980px)').matches) setDrawerOpen(true); else setPreferences(previous => ({ ...previous, collapsed: false })); }}><PanelLeft size={19} /></button><span className={styles.breadcrumb}>NoteWithAI<span>/</span><strong>{label}</strong></span></header>
        <div id="workspace-content" tabIndex={-1} className={styles.content} data-page={pathname.split('/')[1]}>{children}</div>
      </div>
      <WorkspaceSettings open={settingsOpen} initialTab={settingsTab} onClose={closeSettings} returnFocus={restoreSettingsFocus} preferences={preferences} setPreferences={setPreferences} storageError={storageError} />
      <WorkspaceAccountDialogs kind={accountDialog} user={user} onClose={() => { accountDialogKindRef.current = null; setAccountDialog(null); }} onSaved={updateAccount} returnFocus={accountDialogFocus} />
      <dialog ref={confirmRef} className={styles.confirm} aria-label="保存未完成的修改？" onCancel={event => { event.preventDefault(); if (!navigation.busy) navigation.cancel(); }}>
        <h2>保存未完成的修改？</h2><p>这条笔记还有未保存的内容。</p>{navigation.error && <p role="alert" className={styles.error}>{navigation.error}</p>}
        <div className={styles.confirmActions}><button type="button" className={styles.button} disabled={navigation.busy} onClick={navigation.cancel}>继续编辑</button><button type="button" className={styles.button} disabled={navigation.busy} onClick={navigation.discardAndContinue}>放弃修改</button><button type="button" className={`${styles.button} ${styles.primary}`} disabled={navigation.busy} onClick={() => void navigation.saveAndContinue()}>{navigation.busy ? '正在保存…' : '保存并继续'}</button></div>
      </dialog>
    </div>
  </WorkspaceContext.Provider>;
}
