import type { KeyboardEventHandler, RefObject } from 'react';
import type { useNoteTitleSuggestion } from '../../../hooks/useNoteTitleSuggestion';
import styles from '../styles/note-title-field.module.scss';

type Props = {
  value: string;
  onChange: (value: string) => void;
  suggestion: ReturnType<typeof useNoteTitleSuggestion>;
  hasBodyText: boolean;
  saving?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
};

/** Only mounted inside a note's edit form, never on a reading card. */
export default function NoteTitleField({ value, onChange, suggestion, hasBodyText, saving = false,
  inputRef, onKeyDown }: Props) {
  const generating = suggestion.state === 'generating';
  return (
    <div className={styles.field} data-note-editor-inside="true">
      <div className={styles.row}>
        <input
          ref={inputRef}
          type="text"
          aria-label="笔记标题"
          placeholder="标题（可选）"
          className={styles.input}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {(hasBodyText || suggestion.canUndo) && (
          <div className={styles.actions}>
            {hasBodyText && (
              <button
                type="button"
                className={`${styles.action} ${styles.generateButton}`}
                disabled={generating || saving}
                aria-busy={generating}
                title="用 AI 根据当前正文拟标题，保存后生效"
                onClick={() => void suggestion.generate()}
              >
                {generating ? '生成中…' : '帮我拟个标题'}
              </button>
            )}
            {suggestion.canUndo && (
              <button type="button" className={styles.action} onClick={suggestion.undoSuggestion}>撤销生成</button>
            )}
          </div>
        )}
      </div>
      {suggestion.error && <p className={styles.error} role="alert">{suggestion.error}</p>}
    </div>
  );
}
