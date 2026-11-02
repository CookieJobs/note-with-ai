export type AvatarSelection = 'preset:initials' | `preset:${'01' | '02' | '03' | '04' | '05' | '06' | '07' | '08'}`;

export const AVATAR_PRESETS = [
  { id: 'preset:01', label: '小墨', src: '/avatars/profile-preset-01.svg' },
  { id: 'preset:02', label: '蓝角', src: '/avatars/profile-preset-02.svg' },
  { id: 'preset:03', label: '橘团', src: '/avatars/profile-preset-03.svg' },
  { id: 'preset:04', label: '薄荷', src: '/avatars/profile-preset-04.svg' },
  { id: 'preset:05', label: '小紫', src: '/avatars/profile-preset-05.svg' },
  { id: 'preset:06', label: '桃桃', src: '/avatars/profile-preset-06.svg' },
  { id: 'preset:07', label: '麦粒', src: '/avatars/profile-preset-07.svg' },
  { id: 'preset:08', label: '小浪', src: '/avatars/profile-preset-08.svg' },
] as const satisfies ReadonlyArray<{ id: Exclude<AvatarSelection, 'preset:initials'>; label: string; src: string }>;

export type AvatarDisplay = {
  kind: 'preset' | 'legacy-url' | 'initials';
  src?: string;
  initials: string;
};

const getInitials = (username: string) => {
  const name = username.trim();
  if (!name) return 'U';

  const words = name.split(/\s+/u);
  const initials = words.length > 1
    ? words.slice(0, 2).map((word) => Array.from(word)[0] || '')
    : Array.from(name).slice(0, 2);

  return initials.join('').toLocaleUpperCase() || 'U';
};

export function resolveAvatarDisplay(value: string | undefined, username: string): AvatarDisplay {
  const initials = getInitials(username);

  if (!value || value === 'preset:initials') return { kind: 'initials', initials };

  const preset = AVATAR_PRESETS.find((candidate) => candidate.id === value);
  if (preset) return { kind: 'preset', src: preset.src, initials };

  return { kind: 'legacy-url', src: value, initials };
}
