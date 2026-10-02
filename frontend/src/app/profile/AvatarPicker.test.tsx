import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import AvatarPicker from './AvatarPicker';
import { AVATAR_PRESETS, resolveAvatarDisplay } from './avatarPresets';

describe('AvatarPicker', () => {
  it('恰好渲染八款预设和首字母选项且标签可访问', () => {
    render(<AvatarPicker value={null} username="林知夏" onChange={vi.fn()} />);

    const group = screen.getByRole('group', { name: '选择头像' });
    const radios = within(group).getAllByRole('radio');

    expect(radios).toHaveLength(9);
    expect(radios.filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(0);
    expect(screen.getByRole('img', { name: '头像预览：林知' })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: '姓名首字母' })).toBeInTheDocument();
    for (let index = 1; index <= 8; index += 1) {
      expect(within(group).getByRole('radio', { name: `预设头像 ${index}` })).toBeInTheDocument();
    }
  });

  it('原生单选组获焦后激活选项会更新受控预览', () => {
    function ControlledPicker() {
      const [value, setValue] = useState<Parameters<typeof AvatarPicker>[0]['value']>(null);
      return <AvatarPicker value={value} username="林知夏" onChange={setValue} />;
    }

    render(<ControlledPicker />);
    const firstPreset = screen.getByRole('radio', { name: '预设头像 1' });
    const radios = screen.getAllByRole('radio');

    expect(radios.every((radio) => (radio as HTMLInputElement).type === 'radio')).toBe(true);
    expect(radios.every((radio) => (radio as HTMLInputElement).name === 'profile-avatar')).toBe(true);
    firstPreset.focus();
    fireEvent.click(firstPreset);

    expect(firstPreset).toBeChecked();
    expect(screen.getByAltText('头像预览：预设头像 1')).toHaveAttribute('src', '/avatars/profile-preset-01.svg');
  });

  it('将预设键映射到本地资源', () => {
    expect(AVATAR_PRESETS).toHaveLength(8);
    expect(resolveAvatarDisplay('preset:01', '林知夏')).toEqual({
      kind: 'preset',
      src: '/avatars/profile-preset-01.svg',
      initials: '林知',
    });
  });

  it('保持旧 URL 的旧值显示模式', () => {
    const legacyUrl = 'https://legacy.example/avatar.png';
    const onChange = vi.fn();
    render(<AvatarPicker value={null} legacyAvatarUrl={legacyUrl} username="林知夏" onChange={onChange} />);

    expect(screen.getByAltText('头像预览：现有头像')).toHaveAttribute('src', legacyUrl);
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(resolveAvatarDisplay('https://legacy.example/old.png', '林知夏')).toEqual({
      kind: 'legacy-url',
      src: 'https://legacy.example/old.png',
      initials: '林知',
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('旧头像加载失败时回退到首字母并在切换预设后显示新头像', () => {
    const legacyUrl = 'https://legacy.example/avatar.png';
    const onChange = vi.fn();

    function ControlledPicker() {
      const [value, setValue] = useState<Parameters<typeof AvatarPicker>[0]['value']>(null);
      return <AvatarPicker value={value} legacyAvatarUrl={legacyUrl} username="林知夏" onChange={(next) => {
        onChange(next);
        setValue(next);
      }} />;
    }

    render(<ControlledPicker />);
    fireEvent.error(screen.getByAltText('头像预览：现有头像'));

    expect(screen.getByRole('img', { name: '头像预览：林知' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();

    const secondPreset = screen.getByRole('radio', { name: '预设头像 2' });
    fireEvent.click(secondPreset);

    expect(secondPreset).toBeChecked();
    expect(screen.getByAltText('头像预览：预设头像 2')).toHaveAttribute('src', '/avatars/profile-preset-02.svg');
    expect(onChange).toHaveBeenCalledWith('preset:02');
  });
});
