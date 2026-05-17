'use client';

interface NoteCounterProps {
  count: number;
}

export default function NoteCounter({ count }: NoteCounterProps) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-2 px-1 text-sm text-gray-400">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
        <polyline points="14,2 14,8 20,8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
      <span>
        共 <span className="font-semibold text-gray-500">{count}</span> 条笔记
      </span>
    </div>
  );
}
