import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import AdminShell from './components/AdminShell';
import './admin.module.scss';

export const metadata: Metadata = {
  title: '运营后台 · NoteWithAI',
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
