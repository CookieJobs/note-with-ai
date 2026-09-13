'use client';

import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../../components/ui/menu';
import styles from '../styles/note-card.module.scss';

type NoteCardActionsMenuProps = {
  noteId: string;
  aiIncluded: boolean;
  aiPreferenceSaving: boolean;
  onPublish?: () => void;
  onToggleAi: () => void;
  onRequestDelete: () => void;
};

export default function NoteCardActionsMenu({
  noteId,
  aiIncluded,
  aiPreferenceSaving,
  onPublish,
  onToggleAi,
  onRequestDelete,
}: NoteCardActionsMenuProps) {
  return (
    <Menu>
      <MenuTrigger className={styles.noteActionsMenuTrigger} aria-label="笔记操作">
        操作
      </MenuTrigger>
      <MenuContent className={styles.noteActionsMenuContent} aria-label="笔记操作">
        <MenuItem onClick={() => onPublish ? onPublish() : window.location.assign(`/publish/${noteId}`)}>
          公开笔记
        </MenuItem>
        <MenuItem
          disabled={aiPreferenceSaving}
          onClick={onToggleAi}
        >
          {aiPreferenceSaving ? '保存中' : aiIncluded ? '设为不参与 AI' : '恢复参与 AI'}
        </MenuItem>
        <MenuItem className={styles.noteActionsMenuDanger} onClick={onRequestDelete}>
          删除笔记
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
