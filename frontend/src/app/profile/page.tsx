'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, isAuthenticated } from '../../utils/auth';
import { getProfileAnalysis, getStats, triggerProfileAnalysis, type ProfileAnalysisResponse, type UserStats } from '../../services/profileService';
import { updateProfile, changePassword } from '../../services/userService';
import TopNavigation from '../../components/TopNavigation';
import styles from './profile.module.scss';
import { toast } from 'sonner';
import { defaultProfileBackgroundTheme, mapUserProfileToBackgroundTheme } from './profileBackgroundTheme';

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

function EditProfileModal({ open, user, onClose, onSaved }: {
  open: boolean; user: { username?: string; email: string; avatar?: string };
  onClose: () => void; onSaved: (u: { username?: string; avatar?: string }) => void;
}) {
  const [form, setForm] = useState({ username: '', avatar: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm({ username: user.username || '', avatar: user.avatar || '' }), [user.username, user.avatar, open]);
  if (!open) return null;
  const handleSave = async () => {
    if (!form.username.trim()) { toast.error('用户名不能为空'); return; }
    try {
      setSaving(true);
      const updated = await updateProfile({ username: form.username.trim(), avatar: form.avatar.trim() || undefined });
      toast.success('资料更新成功');
      onSaved({ username: updated.username, avatar: updated.avatar });
      onClose();
    } catch { toast.error('更新失败，请稍后重试'); } finally { setSaving(false); }
  };
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="edit-profile-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}><h3 id="edit-profile-title">编辑资料</h3><button className={styles.modalClose} aria-label="关闭" onClick={onClose}>&times;</button></div>
        <div className={styles.modalBody}>
          <label className={styles.fieldLabel} htmlFor="profile-avatar">头像 URL</label>
          <div className={styles.avatarPreviewRow}>
            <div className={styles.avatarPreview}>{form.avatar ? <img src={form.avatar} alt="头像预览" className={styles.avatarImg} /> : <span>{(user.username || 'U')[0].toUpperCase()}</span>}</div>
            <input id="profile-avatar" className={styles.input} placeholder="粘贴图片 URL" value={form.avatar} onChange={(e) => setForm((f) => ({ ...f, avatar: e.target.value }))} />
          </div>
          <label className={styles.fieldLabel} htmlFor="profile-username">用户名</label>
          <input id="profile-username" className={styles.input} placeholder="设置用户名" value={form.username} maxLength={20} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
          <label className={styles.fieldLabel} htmlFor="profile-email">邮箱</label>
          <input id="profile-email" className={styles.input} value={user.email} readOnly disabled />
          <p className={styles.fieldHint}>邮箱暂不支持修改</p>
        </div>
        <div className={styles.modalFooter}><button className={styles.btnCancel} onClick={onClose}>取消</button><button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存'}</button></div>
      </div>
    </div>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm({ oldPassword: '', newPassword: '', confirmPassword: '' }); }, [open]);
  if (!open) return null;
  const handleSave = async () => {
    if (!form.oldPassword) { toast.error('请输入当前密码'); return; }
    if (form.newPassword.length < 8) { toast.error('新密码至少8位'); return; }
    if (!/(?=.*[A-Za-z])(?=.*\d)/.test(form.newPassword)) { toast.error('密码必须包含字母和数字'); return; }
    if (form.newPassword !== form.confirmPassword) { toast.error('两次密码输入不一致'); return; }
    try {
      setSaving(true);
      await changePassword({ oldPassword: form.oldPassword, newPassword: form.newPassword });
      toast.success('密码修改成功，请重新登录');
      setTimeout(() => { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = '/auth'; }, 1500);
    } catch { toast.error('修改失败，请稍后重试'); } finally { setSaving(false); }
  };
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="change-password-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}><h3 id="change-password-title">修改密码</h3><button className={styles.modalClose} aria-label="关闭" onClick={onClose}>&times;</button></div>
        <div className={styles.modalBody}>
          <label className={styles.fieldLabel} htmlFor="old-password">当前密码</label><input id="old-password" className={styles.input} type="password" placeholder="输入当前密码" value={form.oldPassword} onChange={(e) => setForm((f) => ({ ...f, oldPassword: e.target.value }))} />
          <label className={styles.fieldLabel} htmlFor="new-password">新密码</label><input id="new-password" className={styles.input} type="password" placeholder="至少8位，包含字母和数字" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} />
          <label className={styles.fieldLabel} htmlFor="confirm-password">确认新密码</label><input id="confirm-password" className={styles.input} type="password" placeholder="再次输入新密码" value={form.confirmPassword} onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))} />
        </div>
        <div className={styles.modalFooter}><button className={styles.btnCancel} onClick={onClose}>取消</button><button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>{saving ? '修改中…' : '确认修改'}</button></div>
      </div>
    </div>
  );
}

const formatAnalysisScope = (data: ProfileAnalysisResponse) => {
  if (data.analysisInputScope === 'recent_up_to_20') return `最近最多 20 篇笔记${data.analysisInputNoteCount == null ? '' : `（本次输入 ${data.analysisInputNoteCount} 篇）`}`;
  return '范围未知的旧画像';
};

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<ProfileAnalysisResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(true);
  const requestId = useRef(0);
  const statsCache = useRef<UserStats | null>(null);

  const displayedProfile = profile?.userProfile ?? profile?.historicalProfile ?? null;
  const theme = useMemo(() => {
    const currentProfile = profile?.userProfile;
    if (currentProfile?.theme?.cssValue && /^(linear-gradient|radial-gradient|#|rgba?)/i.test(currentProfile.theme.cssValue.trim())) {
      return { id: 'ai-generated' as const, background: currentProfile.theme.cssValue.trim() };
    }
    return currentProfile
      ? mapUserProfileToBackgroundTheme(currentProfile, { seed: user?.email || user?.username })
      : defaultProfileBackgroundTheme;
  }, [profile?.userProfile, user?.email, user?.username]);
  const pageStyle = useMemo(() => ({ ['--profile-background' as string]: theme.background }) as CSSProperties, [theme.background]);

  const loadStats = useCallback(async () => {
    if (!statsCache.current) setStatsLoading(true);
    try {
      const next = await getStats();
      statsCache.current = next;
      setStats(next);
      setStatsError(false);
    }
    catch { setStatsError(true); }
    finally { setStatsLoading(false); }
  }, []);

  const loadProfile = useCallback(async (silent = false) => {
    const id = ++requestId.current;
    if (!silent) setProfileLoading(true);
    try {
      const next = await getProfileAnalysis();
      if (id === requestId.current) { setProfile(next); setProfileError(false); }
    } catch {
      if (id === requestId.current) setProfileError(true);
    } finally {
      if (id === requestId.current && !silent) setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth'); return; }
    setUser(getUser());
    void loadProfile();
    void loadStats();
  }, [loadProfile, loadStats, router]);

  useEffect(() => {
    if (profile?.profileStatus !== 'analyzing') return;
    const timer = window.setInterval(() => { void loadProfile(true); }, 4000);
    return () => window.clearInterval(timer);
  }, [profile?.profileStatus, loadProfile]);

  const handleTriggerAnalysis = async () => {
    try {
      setAnalyzing(true);
      const result = await triggerProfileAnalysis();
      if (result.accepted) {
        setProfile((previous) => previous ? { ...previous, profileStatus: 'analyzing' } : previous);
        toast.success('画像分析已开始，完成后会自动更新');
      } else if (result.reason === 'insufficient_data') {
        setProfile((previous) => previous ? { ...previous, profileStatus: 'insufficient_data' } : previous);
      } else {
        toast.info('已有画像分析任务正在运行');
        void loadProfile(true);
      }
    } catch { toast.error('无法开始画像分析，请稍后重试'); }
    finally { setAnalyzing(false); }
  };

  const handleProfileSaved = (updated: { username?: string; avatar?: string }) => {
    setUser((prev: any) => ({ ...prev, ...updated }));
    const stored = localStorage.getItem('user');
    if (stored) { try { localStorage.setItem('user', JSON.stringify({ ...JSON.parse(stored), ...updated })); } catch {} }
  };

  if (!user) return <div className={styles.page} style={pageStyle}><TopNavigation /><div className={styles.loadingPage}>正在加载账户资料…</div></div>;

  const insufficient = (profile?.noteCount ?? 0) < 5 || profile?.profileStatus === 'insufficient_data';
  const historic = insufficient || (!profile?.userProfile && Boolean(profile?.historicalProfile));
  const canGenerate = !insufficient && profile?.profileStatus !== 'analyzing';
  const scopeText = profile ? formatAnalysisScope(profile) : '';

  return (
    <div className={styles.page} style={pageStyle}>
      <TopNavigation />
      <main className={styles.container}>
        <StatsBar stats={stats} loading={statsLoading} error={statsError} onRetry={() => void loadStats()} />
        <div className={styles.columns}>
          <div className={styles.leftColumn}>
            <section className={`${styles.sectionGroup} ${styles.accountGroup}`} aria-labelledby="account-title">
              <div className={styles.sectionGroupHeader}><h1 id="account-title" className={styles.sectionGroupTitle}>账户设置</h1></div>
              <div className={styles.profileHeader}>
                <div className={styles.avatar}>{user.avatar ? <img src={user.avatar} alt="" className={styles.avatarImg} /> : <span>{(user.username || 'U')[0]?.toUpperCase()}</span>}</div>
                <div className={styles.userInfo}><h2>{user.username || '未设置用户名'}</h2><p>{user.email}</p></div>
              </div>
              <div className={styles.profileActions}><button className={styles.btnOutlineSm} onClick={() => setEditOpen(true)}>编辑资料</button><button className={styles.btnOutlineSm} onClick={() => setPasswordOpen(true)}>修改密码</button></div>
            </section>

            <section className={`${styles.sectionGroup} ${styles.aiGroup}`} aria-labelledby="profile-title">
              <div className={styles.sectionGroupHeader}>
                <h2 id="profile-title" className={styles.sectionGroupTitle}>AI 画像</h2>
                <div className={styles.profileControls}>
                  {canGenerate && <button className={styles.btnGhostSm} onClick={handleTriggerAnalysis} disabled={analyzing}>{analyzing ? '正在提交…' : (historic || profile?.userProfile || profile?.profileStatus === 'failed') ? '重新分析' : '生成画像'}</button>}
                  {profile?.profileStatus === 'analyzing' && <span className={styles.statusPill}>分析中…</span>}
                  <button className={styles.aiGroupToggle} onClick={() => setAiExpanded((v) => !v)} aria-expanded={aiExpanded} aria-label={aiExpanded ? '收起画像' : '展开画像'}><span className={`${styles.aiGroupCollapseIcon} ${aiExpanded ? styles.open : styles.closed}`}>▼</span></button>
                </div>
              </div>
              <p className={styles.sectionGroupHint}>基于最近一次画像分析；分析范围有限，不代表全部笔记。</p>
              <div className={`${styles.aiGroupBody} ${aiExpanded ? styles.expanded : styles.collapsed}`}>
                {profileLoading && !profile && <p className={styles.stateMessage}>正在加载画像…</p>}
                {profileError && <div className={styles.stateMessage} role="alert"><p>{profile ? '画像刷新失败，已保留上次成功显示的数据。' : '画像加载失败，请重试。'}</p><button className={styles.btnOutlineSm} onClick={() => void loadProfile()}>重试画像</button></div>}
                {!profileLoading && !profile && !profileError && <p className={styles.stateMessage}>画像数据暂不可用。</p>}
                {profile && insufficient && <p className={styles.stateMessage}>当前有 {profile.noteCount} 篇笔记，还需要 {Math.max(0, 5 - profile.noteCount)} 篇才能生成画像。当前推断不会作为有效画像展示。</p>}
                {profile?.profileStatus === 'failed' && <div className={styles.analysisError} role="status">画像分析暂未完成，请稍后重试。</div>}
                {profile && historic && profile.historicalProfile && <div className={styles.historyLabel}>历史画像快照</div>}
                {profile && historic && !insufficient && profile.historicalProfile && <p className={styles.stateMessage}>当前笔记数已达到 5 篇，但画像尚未基于当前笔记重新分析。</p>}
                {profile && displayedProfile && <>
                  <p className={styles.profileMetadata}>{profile.lastAnalyzedAt ? `最近分析：${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(profile.lastAnalyzedAt))} · ` : ''}{scopeText}</p>
                  {displayedProfile.expertise && displayedProfile.expertise.length > 0 && <div className={styles.aiSubCard}><h3 className={styles.cardHeading}>技能领域</h3><div className={styles.expertiseList}>{displayedProfile.expertise.map((item, i) => <div key={`${item.area}-${i}`} className={styles.expertiseItem}><span className={styles.expertiseArea}>{item.area}</span><span className={styles.expertiseLevel}>{item.level}</span></div>)}</div></div>}
                  {displayedProfile.summary && <div className={styles.aiSubCard}><h3 className={styles.cardHeading}>个人传记</h3><div className={styles.biography}>{displayedProfile.summary}</div></div>}
                  {displayedProfile.theme?.themeName && <div className={styles.aiSubCard}><h3 className={styles.cardHeading}>专属氛围色：{displayedProfile.theme.themeName}</h3><div className={styles.themeDisplay}>{displayedProfile.theme.reasoning}</div></div>}
                </>}
                {profile && !displayedProfile && !insufficient && profile.profileStatus !== 'failed' && <p className={styles.stateMessage}>还没有画像数据，可以在笔记达到 5 篇后生成。</p>}
              </div>
            </section>
          </div>
          <div className={styles.rightColumn} data-testid="topics-slot" aria-label="笔记话题面板预留位置" />
        </div>
      </main>
      <EditProfileModal open={editOpen} user={user} onClose={() => setEditOpen(false)} onSaved={handleProfileSaved} />
      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
