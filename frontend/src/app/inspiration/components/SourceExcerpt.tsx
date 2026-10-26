'use client';

import { useId, useState } from 'react';
import { getSourceExcerptPreview } from '../utils/sourceExcerpt';
import styles from '../inspiration.module.scss';

export default function SourceExcerpt({ snippet }: { snippet: string }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const preview = getSourceExcerptPreview(snippet);
  if (!snippet.trim()) return null;

  return (
    <div>
      <p
        id={contentId}
        className={`${styles.sourceExcerptText} ${expanded ? styles.sourceExcerptExpanded : ''}`}
      >
        {expanded ? snippet : preview.text || '此来源没有可预览的文字。'}
      </p>
      {preview.expandable && (
        <button
          type="button"
          className={styles.sourceExcerptToggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? '收起来源摘录' : '展开来源摘录'}
        </button>
      )}
    </div>
  );
}
