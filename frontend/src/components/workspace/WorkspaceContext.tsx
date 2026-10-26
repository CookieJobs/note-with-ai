/*
Input: 工作区外壳提供的导航、编辑会话与最近笔记
Output: 页面共享工作区接口；隔离渲染时返回 null
Pos: frontend/src/components/workspace
Note: 修改时同步本目录 README。
*/
'use client';

import { createContext, useContext } from 'react';
import type { MouseEvent } from 'react';
import type { IChat } from '../../types';
import type { User } from '../../utils/auth';
import type { InspirationSettingsController } from '../../hooks/useInspirationSettings';

export type WorkspaceSettingsTab = 'appearance' | 'inspiration' | 'account';
export type WorkspaceAccountDialogKind = 'profile' | 'password';
export type WorkspaceChatNavigation = {
  sessions: IChat[];
  currentSessionId: string;
  isClient: boolean;
  onSessionSelect: (id: string) => void;
  onNewSession: () => void | Promise<void>;
  onDeleteSession: (event: MouseEvent, id: string) => void;
};

export type WorkspaceRecentNote = { id: string; title: string; href: string };
export type WorkspaceEditor = {
  isDirty: () => boolean;
  isSaving: () => boolean;
  save: () => Promise<boolean>;
  discard: () => boolean | void;
  focus?: () => void;
};
export type WorkspaceContextValue = {
  navigate: (href: string) => void;
  requestAction: (action: () => void) => void;
  registerEditor: (editor: WorkspaceEditor) => () => void;
  setRecentNotes: (notes: WorkspaceRecentNote[]) => void;
  user?: User | null;
  openSettings?: (tab?: WorkspaceSettingsTab) => void;
  openAccountDialog?: (kind: WorkspaceAccountDialogKind) => void;
  registerChatNavigation?: (value: WorkspaceChatNavigation) => () => void;
  inspirationSettings?: InspirationSettingsController;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace() { return useContext(WorkspaceContext); }
