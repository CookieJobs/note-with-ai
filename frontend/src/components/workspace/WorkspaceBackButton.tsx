'use client';

import { ArrowLeft } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useWorkspace } from './WorkspaceContext';
import styles from './Workspace.module.scss';

export default function WorkspaceBackButton({ label, onClick, title }: {
  label: string;
  onClick: () => void;
  title?: string;
}) {
  const slot = useWorkspace()?.topbarBack;
  const button = <button type="button" className={styles.backControl} title={title} onClick={onClick}>
    <ArrowLeft size={15} aria-hidden="true" />{label}
  </button>;
  return slot ? createPortal(button, slot) : button;
}
