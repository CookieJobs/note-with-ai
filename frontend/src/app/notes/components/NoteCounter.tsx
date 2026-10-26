'use client';

interface NoteCounterProps {
  count: number;
}

export default function NoteCounter({ count }: NoteCounterProps) {
  if (count === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--workspace-line)] py-5">
      <span className="text-sm font-semibold text-[var(--workspace-ink)]">全部笔记</span>
      <span className="text-xs text-[var(--workspace-muted)]">已加载 {count} 条</span>
    </div>
  );
}
