'use client';
import { useEffect, useRef, useState } from 'react';
type Props = { onSubmit: (reason: string) => Promise<void>; onClose: () => void };
export default function ReasonDialog({ onSubmit, onClose }: Props) {
  const [reason, setReason] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState(''); const dialog = useRef<HTMLDivElement>(null); const previous = useRef<HTMLElement | null>(null);
  const valid = reason.trim().length >= 5 && reason.trim().length <= 200;
  useEffect(() => { previous.current = document.activeElement as HTMLElement; dialog.current?.querySelector('textarea')?.focus(); const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) onClose(); if (e.key === 'Tab' && dialog.current) { const nodes = Array.from(dialog.current.querySelectorAll<HTMLElement>('textarea,button:not([disabled])')); const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }; document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous.current?.focus(); }; }, [pending, onClose]);
  async function submit() { setPending(true); setError(''); try { await onSubmit(reason.trim()); } catch (e: any) { setError(e.message || '提交失败'); } finally { setPending(false); } }
  return <div ref={dialog} role="dialog" aria-modal="true"><label>原因<textarea value={reason} onChange={e => { setReason(e.target.value); setError(''); }} /></label>{error && <p role="alert">{error}</p>}<button disabled={!valid || pending} onClick={submit}>{pending ? '提交中…' : '确认'}</button><button disabled={pending} onClick={onClose}>取消</button></div>;
}
