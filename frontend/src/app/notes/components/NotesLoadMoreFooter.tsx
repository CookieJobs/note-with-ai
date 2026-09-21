interface NotesLoadMoreFooterProps {
  displayedCount: number;
  hasMore: boolean;
  isLoading?: boolean;
  error?: string;
  onLoadMore: () => void;
}

export default function NotesLoadMoreFooter({
  displayedCount,
  hasMore,
  isLoading = false,
  error,
  onLoadMore,
}: NotesLoadMoreFooterProps) {
  return (
    <footer className="flex flex-col items-center gap-3 px-1 pt-1 pb-4 text-sm text-gray-500" aria-label="笔记续读">
      <span>已显示 {displayedCount} 条笔记</span>
      {hasMore ? (
        <>
          {error && <span role="alert" className="text-xs text-red-600">加载失败，请重试</span>}
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoading}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70"
          >
            {isLoading ? '正在加载更早的笔记…' : error ? '重试加载' : '加载更早的笔记'}
          </button>
        </>
      ) : (
        <span className="text-xs text-gray-400">已显示全部笔记</span>
      )}
    </footer>
  );
}
