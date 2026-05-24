/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ArrowRight, Loader2 } from 'lucide-react';
import styles from '../app/chat/chat.module.scss';
import { cn } from '@/lib/utils';

interface ChatInputAreaProps {
  input: string;
  loading: boolean;
  error: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  centered?: boolean; // 当为空状态时，输入框垂直居中显示
  suggestionComponent?: React.ReactNode; // 顶部建议组件插槽
}

const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  input,
  loading,
  error,
  onInputChange,
  onSend,
  centered = false,
  suggestionComponent,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = `${target.scrollHeight}px`;
  };

  // 使用 Tailwind 结合 SCSS 模块的布局
  const containerClassName = cn(
    styles.inputContainer,
    centered && styles.inputContainerCentered,
    "flex flex-col items-center justify-center transition-all duration-300"
  );

  return (
    <>
      {/* 固定/居中的输入框（空状态时居中） */}
      <div className={containerClassName}>
        {suggestionComponent && (
          <div className="w-full max-w-[800px] mb-4">
            {suggestionComponent}
          </div>
        )}

        {centered && (
          <div className={styles.promptTitle}>您现在在想什么？</div>
        )}

        <div className="relative w-full max-w-[800px] flex items-center gap-2 p-2 rounded-[30px] bg-background border border-border/60 shadow-[0_2px_6px_rgba(15,23,42,0.02),0_8px_24px_rgba(15,23,42,0.03)] ring-offset-background focus-within:border-border focus-within:shadow-[0_4px_12px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)] transition-all duration-200">
          <Textarea
            className="min-h-[24px] max-h-[200px] w-full resize-none border-0 bg-transparent px-3 py-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
            placeholder={loading ? "AI正在思考中..." : "输入您的问题..."}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
          />
          <Button
            onClick={onSend}
            disabled={loading || !input.trim()}
            size="icon"
            className={cn(
              "h-9 w-9 rounded-full transition-all duration-200 shrink-0",
              input.trim()
                ? "bg-foreground text-background shadow-[0_2px_8px_rgba(0,0,0,0.15)] hover:bg-foreground/90"
                : "bg-muted text-muted-foreground"
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className={styles.disclaimer}>
          AI也可能会犯错。请核查重要信息
        </div>
      </div>

      {error && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 bg-destructive/95 text-destructive-foreground px-6 py-3 rounded-xl shadow-lg border border-destructive/20 backdrop-blur-sm z-[1000] animate-in slide-in-from-top-2 fade-in">
          {error}
        </div>
      )}
    </>
  );
};

export default ChatInputArea;
