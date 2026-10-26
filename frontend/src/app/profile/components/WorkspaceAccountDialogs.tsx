'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import type { WorkspaceAccountDialogKind } from '../../../components/workspace/WorkspaceContext';
import { changePassword, updateProfile } from '../../../services/userService';
import { getToken, type User } from '../../../utils/auth';
import { schedulePasswordSessionLogout } from '../../../utils/passwordChangeSession';
import AvatarPicker from '../AvatarPicker';
import { AVATAR_PRESETS, type AvatarSelection } from '../avatarPresets';
import styles from './WorkspaceAccountDialogs.module.scss';

export type WorkspaceAccountDialogsProps = {
  kind: WorkspaceAccountDialogKind | null;
  user: User | null;
  onClose: () => void;
  onSaved: (user: User) => void;
  returnFocus?: RefObject<HTMLElement | null>;
};

export default function WorkspaceAccountDialogs(props: WorkspaceAccountDialogsProps) {
  if (!props.kind || !props.user) return null;
  return <AccountDialog key={`${props.user.id}:${props.kind}`} {...props} kind={props.kind} user={props.user} />;
}

function AccountDialog({ kind, user, onClose, onSaved, returnFocus }: WorkspaceAccountDialogsProps & { kind: WorkspaceAccountDialogKind; user: User }) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const active = useRef(true);
  const busy = useRef(false);
  const initialUser = useRef(user).current;
  const [username, setUsername] = useState(initialUser.username || '');
  const [avatar, setAvatar] = useState<AvatarSelection | null>(() => {
    const value = initialUser.avatar;
    return value === 'preset:initials' || AVATAR_PRESETS.some((preset) => preset.id === value)
      ? value as AvatarSelection : value ? null : 'preset:initials';
  });
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState('');
  const dirty = kind === 'profile' ? username !== (initialUser.username || '') || avatarChanged : Object.values(form).some(Boolean);

  useEffect(() => {
    active.current = true;
    const dialog = dialogRef.current;
    const previous = returnFocus?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (dialog && !dialog.open) dialog.showModal();
    firstInputRef.current?.focus();
    return () => {
      active.current = false;
      dialog?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [returnFocus]);

  useEffect(() => { if (confirmDiscard) continueRef.current?.focus(); else firstInputRef.current?.focus(); }, [confirmDiscard]);

  const requestClose = () => {
    if (busy.current) return;
    if (confirmDiscard) { setConfirmDiscard(false); return; }
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const failValidation = (message: string) => { setError(message); toast.error(message); };
  const save = async () => {
    if (busy.current) return;
    if (kind === 'profile') {
      if (!username.trim()) { failValidation('用户名不能为空'); return; }
      if (username.trim().length > 20) { failValidation('用户名最多20个字符'); return; }
    } else {
      if (!form.oldPassword) { failValidation('请输入当前密码'); return; }
      if (form.newPassword.length < 8) { failValidation('新密码至少8位'); return; }
      if (!/(?=.*[A-Za-z])(?=.*\d)/.test(form.newPassword)) { failValidation('密码必须包含字母和数字'); return; }
      if (form.newPassword !== form.confirmPassword) { failValidation('两次密码输入不一致'); return; }
    }
    busy.current = true;
    setSaving(true);
    setError('');
    let passwordChanged = false;
    try {
      if (kind === 'profile') {
        const request: { username: string; avatar?: AvatarSelection } = { username: username.trim() };
        if (avatarChanged && avatar) request.avatar = avatar;
        const updated = await updateProfile(request);
        if (!active.current || (updated.id && updated.id !== initialUser.id)) return;
        onSaved({ ...initialUser, ...updated });
        toast.success('资料更新成功');
        onClose();
      } else {
        const initiatingToken = getToken();
        await changePassword({ oldPassword: form.oldPassword, newPassword: form.newPassword });
        passwordChanged = true;
        schedulePasswordSessionLogout(initialUser.id, initiatingToken);
        if (!active.current) return;
        toast.success('密码修改成功，请重新登录');
        setForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
        // Keep the dialog locked until the existing logout clears the session.
        return;
      }
    } catch {
      if (!active.current) return;
      const message = kind === 'profile' ? '更新失败，请稍后重试' : '修改失败，请稍后重试';
      setError(message);
      toast.error(message);
    } finally {
      if (active.current && !passwordChanged) { busy.current = false; setSaving(false); }
    }
  };

  const title = kind === 'profile' ? '编辑资料' : '修改密码';
  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={`${id}-title`}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); requestClose(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX <= rect.left || event.clientX >= rect.right || event.clientY <= rect.top || event.clientY >= rect.bottom) requestClose();
      }}>
      <header className={styles.header}><h2 id={`${id}-title`}>{title}</h2><button type="button" className={styles.close} aria-label="关闭" disabled={saving} onClick={requestClose}>×</button></header>
      {confirmDiscard ? <div className={styles.confirm} role="alertdialog" aria-labelledby={`${id}-discard`}>
        <h3 id={`${id}-discard`}>放弃未保存的修改？</h3><p>关闭后，这次填写的内容不会保存。</p>
        <div className={styles.footer}><button ref={continueRef} type="button" className={styles.secondary} onClick={() => setConfirmDiscard(false)}>继续编辑</button><button type="button" className={styles.primary} onClick={onClose}>放弃修改</button></div>
      </div> : <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset className={styles.fields} disabled={saving}>
          {kind === 'profile' ? <>
            <AvatarPicker value={avatar} legacyAvatarUrl={initialUser.avatar} username={username || initialUser.username || ''} onChange={(value) => { setAvatar(value); setAvatarChanged(true); }} />
            <label htmlFor={`${id}-username`}>用户名</label><input ref={firstInputRef} id={`${id}-username`} placeholder="设置用户名" autoComplete="nickname" maxLength={20} value={username} onChange={(event) => setUsername(event.target.value)} />
            <label htmlFor={`${id}-email`}>邮箱</label><input id={`${id}-email`} value={user.email} readOnly disabled /><p className={styles.hint}>邮箱暂不支持修改</p>
          </> : <>
            <label htmlFor={`${id}-old`}>当前密码</label><input ref={firstInputRef} id={`${id}-old`} type="password" autoComplete="current-password" placeholder="输入当前密码" value={form.oldPassword} onChange={(event) => setForm((previous) => ({ ...previous, oldPassword: event.target.value }))} />
            <label htmlFor={`${id}-new`}>新密码</label><input id={`${id}-new`} type="password" autoComplete="new-password" placeholder="至少8位，包含字母和数字" value={form.newPassword} onChange={(event) => setForm((previous) => ({ ...previous, newPassword: event.target.value }))} />
            <label htmlFor={`${id}-confirm`}>确认新密码</label><input id={`${id}-confirm`} type="password" autoComplete="new-password" placeholder="再次输入新密码" value={form.confirmPassword} onChange={(event) => setForm((previous) => ({ ...previous, confirmPassword: event.target.value }))} />
          </>}
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </fieldset>
        <footer className={styles.footer}><button type="button" className={styles.secondary} disabled={saving} onClick={requestClose}>取消</button><button type="submit" className={styles.primary} disabled={saving}>{saving ? kind === 'profile' ? '保存中…' : '修改中…' : kind === 'profile' ? '保存' : '确认修改'}</button></footer>
      </form>}
    </dialog>
  );
}
