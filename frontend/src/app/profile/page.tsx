'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, isAuthenticated } from '../../utils/auth';
import { getFeed, triggerAnalysis, getStats, FeedResponse, UserStats } from '../../services/feedService';
import { updateProfile, changePassword } from '../../services/userService';
import TopNavigation from '../../components/TopNavigation';
import styles from './profile.module.scss';
import { toast } from 'sonner';
import { defaultProfileBackgroundTheme, mapUserProfileToBackgroundTheme } from './profileBackgroundTheme';

/* ========== Helpers ========== */

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function formatWords(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

/* ========== Skeleton ========== */

function SkeletonBar() {
  return (
    <div className={styles.statsBar}>
      <div className={styles.skeletonBar} style={{ width: '100%', height: 20 }} />
    </div>
  );
}

function SkeletonFeed() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={styles.sectionGroup} style={{ padding: '1rem' }}>
          <div className={styles.skeletonBar} style={{ width: '30%', height: 14, marginBottom: 12 }} />
          <div className={styles.skeletonBar} style={{ width: '70%', height: 18, marginBottom: 8 }} />
          <div className={styles.skeletonBar} style={{ width: '100%', height: 12, marginBottom: 6 }} />
          <div className={styles.skeletonBar} style={{ width: '85%', height: 12 }} />
        </div>
      ))}
    </div>
  );
}

/* ========== Stats Bar ========== */

function StatsBar({ stats }: { stats: UserStats | null }) {
  if (!stats) return <SkeletonBar />;

  const items = [
    { value: stats.totalNotes, unit: '篇', label: '笔记' },
    { value: stats.notesThisMonth, unit: '篇', label: '本月' },
    { value: stats.streakDays, unit: '天', label: '连续' },
    { value: formatWords(stats.totalWords), unit: '', label: '总字数' },
    { value: stats.avgWordsPerNote, unit: '字', label: '平均' },
    { value: stats.interestCount, unit: '个', label: '兴趣' },
  ];

  return (
    <div className={styles.statsBar}>
      <span className={styles.statsBarLabel}>使用统计</span>
      {items.map((item, i) => (
        <span key={i} className={styles.statsBarItem}>
          <strong>{item.value}</strong> {item.unit} {item.label}
        </span>
      ))}
      {stats.lastAnalyzedAt && (
        <>
          <span className={styles.statsBarDivider} />
          <span className={styles.statsBarTime}>
            画像更新于 {formatTimeAgo(stats.lastAnalyzedAt)}
          </span>
        </>
      )}
    </div>
  );
}

/* ========== Interest Graph ========== */

function InterestGraph({ interests }: { interests: { topic: string; score: number }[] }) {
  if (!interests || interests.length === 0) return null;

  const barColors = [
    '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981',
    '#f59e0b', '#ef4444', '#ec4899', '#6366f1',
  ];

  return (
    <div className={styles.aiSubCard}>
      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', marginBottom: '0.5rem' }}>兴趣图谱</div>
      <div className={styles.interestBars}>
        {interests.map((interest, idx) => {
          const color = barColors[idx % barColors.length];
          const pct = Math.round(interest.score * 100);
          return (
            <div key={idx} className={styles.interestBarRow}>
              <span className={styles.interestLabel}>{interest.topic}</span>
              <div className={styles.interestTrack}>
                <div className={styles.interestFill} style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: color }} />
              </div>
              <span className={styles.interestScore} style={{ color }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ========== Edit Profile Modal ========== */

function EditProfileModal({
  open, user, onClose, onSaved,
}: {
  open: boolean;
  user: { username?: string; email: string; avatar?: string };
  onClose: () => void;
  onSaved: (u: { username?: string; avatar?: string }) => void;
}) {
  const [form, setForm] = useState({ username: '', avatar: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ username: user.username || '', avatar: user.avatar || '' });
  }, [user.username, user.avatar, open]);

  if (!open) return null;

  const handleSave = async () => {
    if (!form.username.trim()) { toast.error('用户名不能为空'); return; }
    try {
      setSaving(true);
      const updated = await updateProfile({ username: form.username.trim(), avatar: form.avatar.trim() || undefined });
      toast.success('资料更新成功');
      onSaved({ username: updated.username, avatar: updated.avatar });
      onClose();
    } catch (e: any) {
      toast.error(e.message || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>编辑资料</h3>
          <button className={styles.modalClose} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.modalBody}>
          <label className={styles.fieldLabel}>头像 URL</label>
          <div className={styles.avatarPreviewRow}>
            <div className={styles.avatarPreview}>
              {form.avatar ? <img src={form.avatar} alt="" className={styles.avatarImg} /> : <span>{(user.username || 'U')[0].toUpperCase()}</span>}
            </div>
            <input className={styles.input} placeholder="粘贴图片 URL" value={form.avatar} onChange={(e) => setForm((f) => ({ ...f, avatar: e.target.value }))} />
          </div>
          <label className={styles.fieldLabel}>用户名</label>
          <input className={styles.input} placeholder="设置用户名" value={form.username} maxLength={20} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
          <label className={styles.fieldLabel}>邮箱</label>
          <input className={styles.input} value={user.email} disabled style={{ opacity: 0.5 }} />
          <p className={styles.fieldHint}>邮箱暂不支持修改</p>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>取消</button>
          <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}

/* ========== Change Password Modal ========== */

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
    } catch (e: any) {
      toast.error(e.message || '修改失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>修改密码</h3>
          <button className={styles.modalClose} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.modalBody}>
          <label className={styles.fieldLabel}>当前密码</label>
          <input className={styles.input} type="password" placeholder="输入当前密码" value={form.oldPassword} onChange={(e) => setForm((f) => ({ ...f, oldPassword: e.target.value }))} />
          <label className={styles.fieldLabel}>新密码</label>
          <input className={styles.input} type="password" placeholder="至少8位，包含字母和数字" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} />
          <label className={styles.fieldLabel}>确认新密码</label>
          <input className={styles.input} type="password" placeholder="再次输入新密码" value={form.confirmPassword} onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))} />
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>取消</button>
          <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>{saving ? '修改中...' : '确认修改'}</button>
        </div>
      </div>
    </div>
  );
}

/* ========== Main Page ========== */

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [data, setData] = useState<FeedResponse | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(true);

  const theme = useMemo(() => {
    if (data?.userProfile?.theme && data.userProfile.theme.cssValue) {
      const isValid = /^linear-gradient|^radial-gradient|#|rgba?/i.test(data.userProfile.theme.cssValue.trim());
      if (isValid) return { id: 'ai-generated' as any, background: data.userProfile.theme.cssValue.trim() };
    }
    const computed = mapUserProfileToBackgroundTheme(data?.userProfile, { seed: user?.email || user?.username });
    if (loading || !data?.userProfile || data?.profileStatus === 'analyzing') return defaultProfileBackgroundTheme;
    return computed;
  }, [data?.profileStatus, data?.userProfile, loading, user?.email, user?.username]);

  const pageStyle = useMemo(
    () => ({ ['--profile-background' as any]: theme.background }) as CSSProperties,
    [theme.background],
  );

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/auth'); return; }
    setUser(getUser());
    loadAll();
  }, [router]);

  // Auto-collapse AI when analyzing, expand when ready
  useEffect(() => {
    if (data?.profileStatus === 'analyzing') setAiExpanded(false);
  }, [data?.profileStatus]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [feedRes, statsRes] = await Promise.allSettled([getFeed(), getStats()]);
      if (feedRes.status === 'fulfilled') setData(feedRes.value);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
    } finally { setLoading(false); }
  };

  const handleTriggerAnalysis = async () => {
    try {
      setAnalyzing(true);
      toast.info('正在开始画像分析，请稍候...');
      await triggerAnalysis();
      toast.success('分析任务已触发，分析完成后画像将自动更新');
      if (data) setData({ ...data, profileStatus: 'analyzing' });
    } catch { toast.error('触发分析失败'); }
    finally { setAnalyzing(false); }
  };

  const handleFeedClick = (noteId: string) => router.push(`/notes?highlight=${noteId}`);

  const handleProfileSaved = (updated: { username?: string; avatar?: string }) => {
    setUser((prev: any) => ({ ...prev, ...updated }));
    const stored = localStorage.getItem('user');
    if (stored) {
      try { localStorage.setItem('user', JSON.stringify({ ...JSON.parse(stored), ...updated })); } catch {}
    }
  };

  if (!user) {
    return (
      <div className={styles.page} style={pageStyle}>
        <TopNavigation />
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 60px)', color: '#888' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 24, height: 24, border: '3px solid rgba(0,0,0,0.1)', borderTopColor: '#333', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <span>Loading...</span>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page} style={pageStyle}>
      <TopNavigation />
      <div className={styles.container}>

        {/* Horizontal Stats Bar */}
        <StatsBar stats={stats} />

        {/* Two Column Grid */}
        <div className={styles.columns}>

          {/* Left Column */}
          <div className={styles.leftColumn}>

            {/* Account Section */}
            <div className={`${styles.sectionGroup} ${styles.accountGroup}`}>
              <div className={styles.sectionGroupHeader}>
                <span className={styles.sectionGroupTitle}>账户设置</span>
              </div>
              <div className={styles.profileHeader}>
                <div className={styles.avatar}>
                  {user.avatar ? <img src={user.avatar} alt="" className={styles.avatarImg} /> : <span>{(user.username || 'U')[0]?.toUpperCase()}</span>}
                </div>
                <div className={styles.userInfo}>
                  <h2>{user.username || '未设置用户名'}</h2>
                  <p>{user.email}</p>
                </div>
              </div>
              <div className={styles.profileActions}>
                <button className={styles.btnOutlineSm} onClick={() => setEditOpen(true)}>编辑资料</button>
                <button className={styles.btnOutlineSm} onClick={() => setPasswordOpen(true)}>修改密码</button>
              </div>
            </div>

            {/* AI Profile Section */}
            <div className={`${styles.sectionGroup} ${styles.aiGroup}`}>
              <div className={styles.sectionGroupHeader}>
                <span className={styles.sectionGroupTitle}>AI 画像</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    className={styles.btnGhostSm}
                    onClick={handleTriggerAnalysis}
                    disabled={analyzing || data?.profileStatus === 'analyzing'}
                  >
                    {data?.profileStatus === 'analyzing' ? '分析中...' : '更新画像'}
                  </button>
                  <button
                    className={styles.aiGroupToggle}
                    onClick={() => setAiExpanded((v) => !v)}
                    title={aiExpanded ? '收起' : '展开'}
                  >
                    <span className={`${styles.aiGroupCollapseIcon} ${aiExpanded ? styles.open : styles.closed}`}>▼</span>
                  </button>
                </div>
              </div>
              <p className={styles.sectionGroupHint}>基于你的笔记内容自动生成，点击更新画像将重新分析最近笔记</p>

              <div className={`${styles.aiGroupBody} ${aiExpanded ? styles.expanded : styles.collapsed}`}>
                {/* Interest Graph */}
                {data?.userProfile?.interests && data.userProfile.interests.length > 0 && (
                  <InterestGraph interests={data.userProfile.interests} />
                )}

                {/* Expertise */}
                {data?.userProfile?.expertise && data.userProfile.expertise.length > 0 && (
                  <div className={styles.aiSubCard}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', marginBottom: '0.5rem' }}>技能领域</div>
                    <div className={styles.expertiseList}>
                      {data.userProfile.expertise.map((exp, idx) => (
                        <div key={idx} className={styles.expertiseItem}>
                          <span className={styles.expertiseArea}>{exp.area}</span>
                          <span className={styles.expertiseLevel}>{exp.level}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Biography */}
                {data?.userProfile?.summary && (
                  <div className={styles.aiSubCard}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', marginBottom: '0.4rem' }}>个人传记</div>
                    <div className={styles.biography}>{data.userProfile.summary}</div>
                  </div>
                )}

                {/* AI Theme */}
                {data?.userProfile?.theme && data.userProfile.theme.themeName && (
                  <div className={styles.aiSubCard}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', marginBottom: '0.4rem' }}>专属氛围色：{data.userProfile.theme.themeName}</div>
                    <div className={styles.themeDisplay}>{data.userProfile.theme.reasoning}</div>
                  </div>
                )}

                {/* Empty state when no AI data yet */}
                {!data?.userProfile?.interests?.length &&
                  !data?.userProfile?.expertise?.length &&
                  !data?.userProfile?.summary && (
                  <div style={{ fontSize: '0.8rem', color: '#9ca3af', textAlign: 'center', padding: '1rem 0' }}>
                    还没有画像数据，点击「更新画像」开始分析
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Feed */}
          <div className={styles.rightColumn}>
            <h2 className={styles.pageTitle}>每日推荐 (For You)</h2>

            {loading ? (
              <SkeletonFeed />
            ) : data?.feed && data.feed.length > 0 ? (
              <div className={styles.feedList}>
                {data.feed.map((item, idx) => (
                  <div key={idx} className={styles.feedItem} onClick={() => handleFeedClick(item.noteId)}>
                    <div className={styles.feedAccent} data-type={item.type} />
                    <div className={styles.feedHeader}>
                      <span className={styles.feedType} data-type={item.type}>{item.type === 'rediscover' ? '温故知新' : '最新动态'}</span>
                      <span className={styles.feedReason}>{item.reason}</span>
                    </div>
                    <div className={styles.feedTitle}>{item.title || '未命名笔记'}</div>
                    <div className={styles.feedPreview}>{item.content}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <p>暂无推荐内容。</p>
                <p>多写几条笔记，或者点击左侧「更新画像」来生成推荐。</p>
                <button onClick={() => router.push('/notes')}>去写笔记</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <EditProfileModal open={editOpen} user={user} onClose={() => setEditOpen(false)} onSaved={handleProfileSaved} />
      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
