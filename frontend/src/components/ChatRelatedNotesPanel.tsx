import React from 'react';
import { IRelatedNote } from '../types';

interface ChatRelatedNotesPanelProps {
  relatedNotes: IRelatedNote[];
  className?: string;
  onNoteClick?: (noteId: string) => void;
}

export const ChatRelatedNotesPanel: React.FC<ChatRelatedNotesPanelProps> = ({
  relatedNotes,
  className = '',
  onNoteClick
}) => {
  // 开发模式下打印日志，方便调试数据更新
  if (process.env.NODE_ENV === 'development') {
    console.log('📝 ChatRelatedNotesPanel received notes:', relatedNotes?.length);
  }

  const getSimilarityLabel = (similarity: number) => {
    if (similarity >= 0.9) return '高度相关';
    if (similarity >= 0.8) return '相关';
    if (similarity >= 0.7) return '可能相关';
    return '弱相关';
  };

  return (
    <div className={`flex flex-col bg-white h-full overflow-hidden ${className}`}>
      <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
        <h2 className="text-lg font-semibold text-gray-900">
          相关笔记
          {relatedNotes.length > 0 && <span className="ml-2 text-sm text-gray-500 font-normal">({relatedNotes.length})</span>}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
        {relatedNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center mt-20 gap-3">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gray-300" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <circle cx="10" cy="13" r="2"></circle>
              <line x1="11.4" y1="14.4" x2="15" y2="18"></line>
            </svg>
            <div className="text-gray-500 font-medium">暂无相关笔记</div>
            <div className="text-xs text-gray-400 max-w-[200px]">
              随着对话进行，这里会显示相关的笔记内容
            </div>
          </div>
        ) : (
          relatedNotes.map((note, index) => {
            const score = typeof note.score === 'number' ? note.score : (note.similarity || 0);
            const noteId = note.noteId || note.id || '';
            return (
              <div
                key={`${noteId}-${index}`}
                className="p-4 rounded-xl border border-gray-100 bg-gray-50 hover:bg-white hover:shadow-sm hover:border-gray-200 transition-all cursor-pointer flex flex-col gap-2"
                onClick={() => noteId && onNoteClick && onNoteClick(noteId)}
              >
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium text-gray-900 truncate flex-1">{note.title || '无标题'}</div>
                <span className="shrink-0 bg-blue-50 text-blue-600 rounded-full px-2 py-0.5 text-[10px] font-medium border-none">
                  {getSimilarityLabel(score)}
                </span>
              </div>
              
              <div className="flex items-center gap-3 text-[10px] text-gray-400 font-mono bg-gray-100/50 p-1.5 rounded-lg border border-gray-100 w-fit">
                <div className="flex flex-col">
                  <span className="text-gray-500 font-semibold text-[11px]">
                    {score ? score.toFixed(2) : '0.00'}
                  </span>
                  <span>相关度</span>
                </div>
              </div>
              
              <div className="text-sm text-gray-600 line-clamp-3">
                {note.content || '暂无内容...'}
              </div>
              
              {note.reason && (
                <div className="mt-2 text-xs text-gray-400 bg-gray-100/50 p-2 rounded-lg leading-relaxed">
                  💡 {note.reason}
                </div>
              )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ChatRelatedNotesPanel;
