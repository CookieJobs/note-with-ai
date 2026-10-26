/*
Input: 工作区外观偏好与关闭动作
Output: 覆盖当前任务的原生设置弹窗，不卸载业务内容
Pos: frontend/src/components/workspace
Note: 修改时同步本目录 README。
*/
'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { Moon, Sun, Monitor, X, Palette, UserRound, Sparkles } from 'lucide-react';
import type { WorkspacePreferences } from './useWorkspacePreferences';
import { useWorkspace, type WorkspaceSettingsTab } from './WorkspaceContext';
import ScheduledDiscoverySettings from '../../app/inspiration/components/ScheduledDiscoverySettings';
import styles from './Workspace.module.scss';

type Props = { open: boolean; initialTab?: WorkspaceSettingsTab; onClose: () => void; returnFocus: RefObject<HTMLElement | null>; preferences: WorkspacePreferences; setPreferences: Dispatch<SetStateAction<WorkspacePreferences>>; storageError: boolean };
export default function WorkspaceSettings({ open, initialTab = 'appearance', onClose, returnFocus, preferences, setPreferences, storageError }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState('appearance');
  const workspace = useWorkspace();
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) { dialog.close(); returnFocus.current?.focus(); }
  }, [open, returnFocus]);
  const tabs = [{ id: 'appearance', label: '外观', Icon: Palette }, { id: 'inspiration', label: '灵感', Icon: Sparkles }, { id: 'account', label: '账户', Icon: UserRound }];
  return <dialog ref={ref} aria-label="设置" className={styles.settings} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === ref.current) onClose(); }}>
    <header className={styles.dialogHeader}><h2>设置</h2><button className={styles.iconButton} type="button" aria-label="关闭设置" onClick={onClose}><X size={20} /></button></header>
    <div className={styles.settingsLayout}>
      <nav className={styles.settingsTabs} aria-label="设置分类">{tabs.map(({ id, label, Icon }) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={17} />{label}</button>)}</nav>
      <section className={styles.settingsContent} aria-label={tabs.find(item => item.id === tab)?.label}>
        {tab === 'appearance' && <>
          <h3>外观</h3><p className={styles.muted}>选择适合当前环境的阅读体验。</p>
          <div className={styles.themes} role="radiogroup" aria-label="主题">{([{ value: 'light', label: '浅色', Icon: Sun }, { value: 'dark', label: '深色', Icon: Moon }, { value: 'system', label: '跟随系统', Icon: Monitor }] as const).map(({ value, label, Icon }) => <button type="button" key={value} role="radio" aria-checked={preferences.theme === value} onClick={() => setPreferences(previous => ({ ...previous, theme: value }))}><span data-preview={value} className={styles.themePreview}><i /><i /></span><span><Icon size={16} />{label}</span></button>)}</div>
          <div className={styles.settingRow}><div><strong>正文字号</strong><p>用于笔记正文与对话回答。</p></div><div className={styles.segments} role="group" aria-label="正文字号">{([{ value: 'small', label: '小' }, { value: 'standard', label: '标准' }, { value: 'large', label: '大' }] as const).map(({ value, label }) => <button type="button" key={value} aria-pressed={preferences.readingSize === value} onClick={() => setPreferences(previous => ({ ...previous, readingSize: value }))}>{label}</button>)}</div></div>
          <div className={styles.settingRow}><div><strong>减少动态效果</strong><p>保留状态变化，减少过渡动画。</p></div><button type="button" role="switch" aria-label="减少动态效果" aria-checked={preferences.reduceMotion} className={styles.switch} onClick={() => setPreferences(previous => ({ ...previous, reduceMotion: !previous.reduceMotion }))}><span /></button></div>
          <p className={styles.preferenceNote}>外观偏好保存在当前浏览器，仅用于 NoteWithAI 工作区。</p>
          {storageError && <p role="status" className={styles.error}>当前浏览器无法保存偏好，本次选择仍然有效。</p>}
        </>}
        {tab === 'inspiration' && <><h3>灵感</h3>{workspace?.inspirationSettings && <ScheduledDiscoverySettings controller={workspace.inspirationSettings} />}</>}
        {tab === 'account' && <><h3>账户</h3><p className={styles.muted}>管理你的资料和登录安全。</p><div className={styles.settingRow}><div><strong>{workspace?.user?.username || '我的账户'}</strong><p>{workspace?.user?.email}</p></div><button className={styles.button} type="button" onClick={() => workspace?.openAccountDialog?.('profile')}>编辑资料</button></div><div className={styles.settingRow}><div><strong>密码</strong><p>修改密码后需要重新登录。</p></div><button className={styles.button} type="button" onClick={() => workspace?.openAccountDialog?.('password')}>修改密码</button></div></>}
      </section>
    </div>
  </dialog>;
}
