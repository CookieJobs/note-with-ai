/*
Input: 当前浏览器的外观偏好和系统主题
Output: 工作区专属外观，不修改 html/body 或笔记内容
Pos: frontend/src/components/workspace
Note: 修改时同步本目录 README。
*/
'use client';

import { useEffect, useState } from 'react';

export type WorkspacePreferences = { theme: 'light' | 'dark' | 'system'; readingSize: 'small' | 'standard' | 'large'; reduceMotion: boolean; collapsed: boolean };
const defaults: WorkspacePreferences = { theme: 'light', readingSize: 'standard', reduceMotion: false, collapsed: false };
const key = 'nwai.workspace.preferences.v1';

export function useWorkspacePreferences() {
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [systemDark, setSystemDark] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      if (saved && typeof saved === 'object') setPreferences({
        theme: ['light', 'dark', 'system'].includes(saved.theme) ? saved.theme : defaults.theme,
        readingSize: ['small', 'standard', 'large'].includes(saved.readingSize) ? saved.readingSize : defaults.readingSize,
        reduceMotion: saved.reduceMotion === true, collapsed: saved.collapsed === true,
      });
    } catch { setStorageError(true); }
    setReady(true);
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(key, JSON.stringify(preferences)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [preferences, ready]);
  return { preferences, setPreferences, storageError, theme: preferences.theme === 'system' ? systemDark ? 'dark' : 'light' : preferences.theme };
}
