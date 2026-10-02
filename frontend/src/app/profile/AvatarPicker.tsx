'use client';

import { useState } from 'react';
import styles from './AvatarPicker.module.scss';
import { AVATAR_PRESETS, resolveAvatarDisplay, type AvatarSelection } from './avatarPresets';

type AvatarPickerProps = {
  value: AvatarSelection | null;
  legacyAvatarUrl?: string;
  username: string;
  onChange: (value: AvatarSelection) => void;
};

export default function AvatarPicker({ value, legacyAvatarUrl, username, onChange }: AvatarPickerProps) {
  const display = resolveAvatarDisplay(value === null ? legacyAvatarUrl : value, username);
  const [failedPreviewSrc, setFailedPreviewSrc] = useState<string>();
  const showImage = Boolean(display.src && display.src !== failedPreviewSrc);
  const previewLabel = display.kind === 'preset'
    ? AVATAR_PRESETS.find((preset) => preset.id === value)?.label || '预设头像'
    : display.kind === 'legacy-url'
      ? '现有头像'
      : `姓名首字母 ${display.initials}`;

  return (
    <div className={styles.picker}>
      <div className={styles.preview} aria-live="polite" aria-atomic="true">
        {showImage && display.src
          ? <img src={display.src} alt={`头像预览：${previewLabel}`} onError={() => setFailedPreviewSrc(display.src)} />
          : <span role="img" aria-label={`头像预览：${display.initials}`}>{display.initials}</span>}
      </div>
      <fieldset className={styles.options}>
        <legend>选择头像</legend>
        <div className={styles.grid}>
          <div className={styles.option}>
            <input
              id="profile-avatar-initials"
              className={styles.radio}
              type="radio"
              name="profile-avatar"
              value="preset:initials"
              checked={value === 'preset:initials'}
              onChange={() => onChange('preset:initials')}
            />
            <label htmlFor="profile-avatar-initials" className={styles.optionLabel}>
              <span className={styles.swatchInitials} aria-hidden="true">{display.initials}</span>
              <span>姓名首字母</span>
            </label>
          </div>
          {AVATAR_PRESETS.map((preset) => (
            <div className={styles.option} key={preset.id}>
              <input
                id={`profile-avatar-${preset.id}`}
                className={styles.radio}
                type="radio"
                name="profile-avatar"
                value={preset.id}
                checked={value === preset.id}
                onChange={() => onChange(preset.id)}
              />
              <label htmlFor={`profile-avatar-${preset.id}`} className={styles.optionLabel}>
                <img src={preset.src} alt="" />
                <span>{preset.label}</span>
              </label>
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
