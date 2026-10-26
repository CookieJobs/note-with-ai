/*
Input: 共享或独立账户身份、真实统计与画像服务
Output: 保留认证守卫的个人资料页，等待共享身份初始化并隔离迟到响应
Pos: profile 页面入口；修改时同步 ./README.md。
*/
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, isAuthenticated, type User } from '../../utils/auth';
import { getProfileAnalysis, getStats, triggerProfileAnalysis, type ProfileAnalysisResponse, type UserStats } from '../../services/profileService';
import TopNavigation from '../../components/TopNavigation';
import styles from './profile.module.scss';
import WorkspaceAccountDialogs from './components/WorkspaceAccountDialogs';
import { useWorkspace, type WorkspaceAccountDialogKind } from '../../components/workspace/WorkspaceContext';
import { toast } from 'sonner';
import { resolveAvatarDisplay } from './avatarPresets';

function StatsBar({ stats, loading, error, onRetry }: {
  stats: UserStats | null; loading: boolean; error: boolean; onRetry: () => void;
}) {
  return (
    <div className={styles.statsBar} aria-live="polite">
      <span className={styles.statsBarLabel}>使用统计</span>
      {loading && !stats ? <div className={styles.skeletonBar} style={{ width: 180, height: 20 }} aria-label="统计加载中" /> : error && !stats ? (
        <><span className={styles.statsError}>统计暂不可用</span><button className={styles.btnOutlineSm} onClick={onRetry}>重试统计</button></>
      ) : stats && <>
        <span className={styles.statsBarItem}><strong>{stats.totalNotes}</strong> 篇 笔记</span>
        <span className={styles.statsBarItem}><strong>{stats.notesThisMonth}</strong> 篇 本月</span>
        {error && <><span className={styles.statsError}>刷新失败，显示上次数据</span><button className={styles.btnOutlineSm} onClick={onRetry}>重试统计</button></>}
      </>}
    </div>
  );
}

const formatAnalysisScope = (data: ProfileAnalysisResponse) => {
  if (data.analysisInputScope === 'recent_up_to_20') return `最近最多 20 篇笔记${data.analysisInputNoteCount == null ? '' : `（本次输入 ${data.analysisInputNoteCount} 篇）`}`;
  return '范围未知的旧画像';
};

const formatAnalysisTime = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

const PROFILE_POLL_INTERVAL_MS = 4000;
const PROFILE_POLL_MAX_ATTEMPTS = 15;

export default function ProfilePage() {
  const router = useRouter();
  const workspace = useWorkspace();
  const [fallbackUser, setUser] = useState<User | null>(null);
  const user = workspace ? workspace.user : fallbackUser;
  const [profile, setProfile] = useState<ProfileAnalysisResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [profilePollExhausted, setProfilePollExhausted] = useState(false);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [accountDialog, setAccountDialog] = useState<WorkspaceAccountDialogKind | null>(null);
  const openAccountDialog = workspace?.openAccountDialog ?? setAccountDialog;
  const [failedAvatarSrc, setFailedAvatarSrc] = useState<string>();
  const [aiExpanded, setAiExpanded] = useState(true);
  const profileRequestId = useRef(0);
  const statsRequestId = useRef(0);
  const profileController = useRef<AbortController | null>(null);
  const statsController = useRef<AbortController | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const statsCache = useRef<UserStats | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      profileController.current?.abort();
      statsController.current?.abort();
      analysisController.current?.abort();
    };
  }, []);

  const displayedProfile = profile?.userProfile ?? profile?.historicalProfile ?? null;
  const avatarDisplay = resolveAvatarDisplay(user?.avatar, user?.username || '');

  const loadStats = useCallback(async () => {
    if (!statsCache.current) setStatsLoading(true);
    const id = ++statsRequestId.current;
    statsController.current?.abort();
    const controller = new AbortController();
    statsController.current = controller;
    try {
      const next = await getStats(controller.signal);
      if (!mounted.current || id !== statsRequestId.current || controller.signal.aborted) return;
      statsCache.current = next;
      setStats(next);
      setStatsError(false);
    }
    catch { if (mounted.current && id === statsRequestId.current && !controller.signal.aborted) setStatsError(true); }
    finally { if (mounted.current && id === statsRequestId.current) setStatsLoading(false); }
  }, []);

  const loadProfile = useCallback(async (silent = false) => {
    const id = ++profileRequestId.current;
    profileController.current?.abort();
    const controller = new AbortController();
    profileController.current = controller;
    if (!silent) setProfilePollExhausted(false);
    if (!silent) setProfileLoading(true);
    if (mounted.current) setProfileError(false);
    try {
      const next = await getProfileAnalysis(controller.signal);
      if (mounted.current && id === profileRequestId.current && !controller.signal.aborted) {
        setProfile(next);
        setProfileError(false);
        return next;
      }
    } catch {
      if (mounted.current && id === profileRequestId.current && !controller.signal.aborted) setProfileError(true);
    } finally {
      if (mounted.current && id === profileRequestId.current && !silent) setProfileLoading(false);
    }
    return null;
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth'); return; }
    if (workspace) return;
    setUser(getUser());
  }, [workspace, router]);

  useEffect(() => {
    profileRequestId.current += 1;
    statsRequestId.current += 1;
    profileController.current?.abort();
    statsController.current?.abort();
    analysisController.current?.abort();
    statsCache.current = null;
    setProfile(null);
    setStats(null);
    setProfileLoading(true);
    setStatsLoading(true);
    setProfileError(false);
    setStatsError(false);
    setProfilePollExhausted(false);
    setAnalyzing(false);
    if (user?.id) { void loadProfile(); void loadStats(); }
    return () => {
      profileRequestId.current += 1;
      statsRequestId.current += 1;
      profileController.current?.abort();
      statsController.current?.abort();
      analysisController.current?.abort();
    };
  }, [user?.id, loadProfile, loadStats]);

  useEffect(() => {
    if (profile?.profileStatus !== 'analyzing' || profileError || profilePollExhausted || profileLoading) return;
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;
    const scheduleNext = () => {
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        attempts += 1;
        const next = await loadProfile(true);
        if (cancelled || !next || next.profileStatus !== 'analyzing') return;
        if (attempts >= PROFILE_POLL_MAX_ATTEMPTS) {
          setProfilePollExhausted(true);
          return;
        }
        scheduleNext();
      }, PROFILE_POLL_INTERVAL_MS);
    };
    scheduleNext();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [profile?.profileStatus, profileError, profilePollExhausted, profileLoading, loadProfile]);

  const handleTriggerAnalysis = async () => {
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    try {
      setAnalyzing(true);
      const result = await triggerProfileAnalysis(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (result.accepted) {
        setProfile((previous) => previous ? { ...previous, profileStatus: 'analyzing' } : previous);
        setProfileError(false);
        setProfilePollExhausted(false);
        toast.success('画像分析已开始，完成后会自动更新');
      } else if (result.reason === 'insufficient_data') {
        setProfile((previous) => previous ? { ...previous, profileStatus: 'insufficient_data' } : previous);
      } else {
        toast.info('已有画像分析任务正在运行');
        setProfilePollExhausted(false);
        void loadProfile();
      }
    } catch { if (mounted.current && !controller.signal.aborted) toast.error('无法开始画像分析，请稍后重试'); }
    finally { if (mounted.current && analysisController.current === controller) setAnalyzing(false); }
  };

  const handleProfileSaved = (updated: User) => {
    setUser((prev) => prev?.id === updated.id ? { ...prev, ...updated } : prev);
    const stored = localStorage.getItem('user');
    if (stored) { try { localStorage.setItem('user', JSON.stringify(JSON.parse(stored).id === updated.id ? { ...JSON.parse(stored), ...updated } : JSON.parse(stored))); } catch {} }
  };

  if (!user) return <div className={styles.page}><TopNavigation /><div className={styles.loadingPage}>正在加载账户资料…</div></div>;

  const insufficient = (profile?.noteCount ?? 0) < 5 || profile?.profileStatus === 'insufficient_data';
  const historic = insufficient || (!profile?.userProfile && Boolean(profile?.historicalProfile));
  const canGenerate = !insufficient && profile?.profileStatus !== 'analyzing';
  const canRecoverAnalysis = profile?.profileStatus === 'analyzing' && profilePollExhausted;
  const scopeText = profile ? formatAnalysisScope(profile) : '';

  return (
    <div className={styles.page}>
      <TopNavigation />
      <main className={styles.container}>
        <section className={styles.profileHeader} aria-labelledby="account-title">
                <div className={styles.avatar}>{avatarDisplay.src && avatarDisplay.src !== failedAvatarSrc
                  ? <img src={avatarDisplay.src} alt="" className={styles.avatarImg} onError={() => setFailedAvatarSrc(avatarDisplay.src)} />
                  : <span>{avatarDisplay.initials}</span>}</div>
                <div className={styles.userInfo}><h1 id="account-title">{user.username || '未设置用户名'}</h1><p>{user.email}</p></div>
          <button className={styles.btnOutlineSm} onClick={() => openAccountDialog('profile')}>编辑资料</button>
        </section>
        <StatsBar stats={stats} loading={statsLoading} error={statsError} onRetry={() => void loadStats()} />
        <section className={styles.sectionGroup} aria-labelledby="profile-title">
              <div className={styles.sectionGroupHeader}>
                <h2 id="profile-title" className={styles.sectionGroupTitle}>AI 画像</h2>
                <div className={styles.profileControls}>
                  {canGenerate && <button className={styles.btnGhostSm} onClick={handleTriggerAnalysis} disabled={analyzing}>{analyzing ? '正在提交…' : (historic || profile?.userProfile || profile?.profileStatus === 'failed') ? '重新分析' : '生成画像'}</button>}
                  {canRecoverAnalysis && <><button className={styles.btnGhostSm} onClick={() => void loadProfile()} disabled={profileLoading}>检查进度</button><button className={styles.btnGhostSm} onClick={() => void handleTriggerAnalysis()} disabled={analyzing}>{analyzing ? '正在提交…' : '恢复分析'}</button></>}
                  {profile?.profileStatus === 'analyzing' && <span className={styles.statusPill}>分析中…</span>}
                  <button className={styles.aiGroupToggle} onClick={() => setAiExpanded((v) => !v)} aria-expanded={aiExpanded} aria-label={aiExpanded ? '收起画像' : '展开画像'}><span className={`${styles.aiGroupCollapseIcon} ${!aiExpanded ? styles.closed : ''}`}>▼</span></button>
                </div>
              </div>
              <p className={styles.sectionGroupHint}>基于最近一次画像分析；技能等级由 AI 归纳，分析范围有限，不代表全部笔记。</p>
              <div className={styles.aiGroupBody} hidden={!aiExpanded}>
                {profileLoading && !profile && <p className={styles.stateMessage}>正在加载画像…</p>}
                {profileError && <div className={styles.stateMessage} role="alert"><p>{profile ? '画像刷新失败，已保留上次成功显示的数据。' : '画像加载失败，请重试。'}</p><button className={styles.btnOutlineSm} onClick={() => void loadProfile()}>重试画像</button></div>}
                {!profileLoading && !profile && !profileError && <p className={styles.stateMessage}>画像数据暂不可用。</p>}
                {profile && insufficient && <p className={styles.stateMessage}>当前有 {profile.noteCount} 篇笔记，还需要 {Math.max(0, 5 - profile.noteCount)} 篇才能生成画像。当前推断不会作为有效画像展示。</p>}
                {profile?.profileStatus === 'failed' && <div className={styles.analysisError} role="status">画像分析暂未完成，请稍后重试。</div>}
                {profile?.profileStatus === 'failed' && profile.analysisFailedAt && <p className={styles.profileMetadata}>最近失败：{formatAnalysisTime(profile.analysisFailedAt)}</p>}
                {canRecoverAnalysis && <div className={styles.stateMessage} role="status">画像仍未完成，可检查进度或恢复分析。</div>}
                {profile && historic && profile.historicalProfile && <div className={styles.historyLabel}>历史画像快照</div>}
                {profile && historic && !insufficient && profile.historicalProfile && <p className={styles.stateMessage}>当前笔记数已达到 5 篇，但画像尚未基于当前笔记重新分析。</p>}
                {profile && displayedProfile && <>
                  <p className={styles.profileMetadata}>{profile.lastAnalyzedAt ? `最近分析：${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(profile.lastAnalyzedAt))} · ` : ''}{scopeText}</p>
                  {displayedProfile.expertise && displayedProfile.expertise.length > 0 && <div className={styles.aiSubCard}><h3 className={styles.cardHeading}>技能领域</h3><div className={styles.expertiseList}>{displayedProfile.expertise.map((item, i) => <div key={`${item.area}-${i}`} className={styles.expertiseItem}><span className={styles.expertiseArea}>{item.area}</span><span className={styles.expertiseLevel}>{item.level}</span></div>)}</div></div>}
                  {displayedProfile.summary && <div className={styles.aiSubCard}><h3 className={styles.cardHeading}>个人传记</h3><div className={styles.biography}>{displayedProfile.summary}</div></div>}
                </>}
                {profile && !displayedProfile && !insufficient && profile.profileStatus !== 'failed' && <p className={styles.stateMessage}>还没有画像数据，可以在笔记达到 5 篇后生成。</p>}
              </div>
        </section>
        <section className={styles.sectionGroup} aria-labelledby="account-settings-title">
          <div className={styles.sectionGroupHeader}><h2 id="account-settings-title" className={styles.sectionGroupTitle}>账户设置</h2></div>
          <div className={styles.accountList}>
            <div className={styles.accountRow}><span>邮箱</span><span className={styles.accountValue}>{user.email} · 只读</span></div>
            <div className={styles.accountRow}><span>密码</span><button className={styles.btnGhostSm} onClick={() => openAccountDialog('password')}>修改密码</button></div>
            {workspace?.openSettings && <div className={styles.accountRow}><span>外观</span><button className={styles.btnGhostSm} onClick={() => workspace.openSettings?.('appearance')}>外观设置</button></div>}
          </div>
        </section>
      </main>
      {!workspace && <WorkspaceAccountDialogs kind={accountDialog} user={user} onClose={() => setAccountDialog(null)} onSaved={handleProfileSaved} />}
    </div>
  );
}
