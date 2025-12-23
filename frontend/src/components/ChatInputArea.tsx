/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import React from 'react';
import styles from '../app/chat/chat.module.scss';

interface ChatInputAreaProps {
  input: string;
  loading: boolean;
  error: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  centered?: boolean; // 当为空状态时，输入框垂直居中显示
}

const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  input,
  loading,
  error,
  onInputChange,
  onSend,
  centered = false,
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

  const containerClassName = `${styles.inputContainer} ${centered ? styles.inputContainerCentered : ''}`;

  return (
    <>
      {/* 固定/居中的输入框（空状态时居中） */}
      <div className={containerClassName}>
        {centered && (
          <div className={styles.promptTitle}>您现在在想什么？</div>
        )}
        <div className={styles.inputWrapper}>
          <textarea
            className={styles.inputField}
            placeholder={loading ? "AI正在思考中..." : "输入您的问题..."}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
          />
          <button
            onClick={onSend}
            disabled={loading || !input.trim()}
            className={styles.submitButton}
          >
            {loading ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="31.416">
                  <animate attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416;0 31.416" repeatCount="indefinite"/>
                  <animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416;-31.416" repeatCount="indefinite"/>
                </circle>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
        <div className={styles.disclaimer}>
          AI也可能会犯错。请核查重要信息
        </div>
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
    </>
  );
};

export default ChatInputArea;
