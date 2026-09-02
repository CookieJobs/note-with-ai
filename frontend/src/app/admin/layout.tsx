import type { Metadata } from 'next';
import AdminShell from './components/AdminShell';
import './admin.module.scss';
export const metadata: Metadata = { title: '运营后台 · NoteWithAI' };
export default function AdminLayout({ children }: { children: React.ReactNode }) { return <AdminShell>{children}</AdminShell>; }
