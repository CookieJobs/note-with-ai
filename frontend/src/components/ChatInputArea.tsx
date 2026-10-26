/*
Input: 聊天输入、发送状态、回调、情境输入提示和可选笔记建议
Output: 输入优先的起始页或会话底部输入区，提供可读错误提示并保留中文输入法与快捷键保护
Pos: frontend/src/components
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import React from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import styles from '../app/chat/chat.module.scss';
import { cn } from '@/lib/utils';

interface ChatInputAreaProps {
  input: string;
  loading: boolean;
  error: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  centered?: boolean; // 当为空状态时，输入框垂直居中显示
  suggestionComponent?: React.ReactNode; // 输入区之后的可选笔记建议
  placeholder?: string;
  title?: string;
}

const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  input,
  loading,
  error,
  onInputChange,
  onSend,
  centered = false,
  suggestionComponent,
  placeholder = '输入您的问题...',
  title = '今天，想从哪里聊起？',
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (loading || !input.trim()) return;
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
        {centered && (
          <h1 className={styles.promptTitle}>{title}</h1>
        )}

        <div className={styles.composer}>
          <textarea
            className={styles.composerTextarea}
            aria-label="聊天消息"
            placeholder={loading ? "AI正在思考中..." : placeholder}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
          />
          <button
            type="button"
            aria-label="发送消息"
            onClick={onSend}
            disabled={loading || !input.trim()}
            className={styles.sendButton}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className={styles.disclaimer}>
          AI也可能会犯错。请核查重要信息
        </div>

        {suggestionComponent && (
          <div className={styles.suggestionSlot}>
            {suggestionComponent}
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className={styles.chatError}>
          {error}
        </div>
      )}
    </>
  );
};

export default ChatInputArea;
