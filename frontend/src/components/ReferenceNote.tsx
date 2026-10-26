import { ArrowUpRight, FileText } from 'lucide-react';
import styles from './RelatedNotes.module.scss';
import { noteReferenceDisplay, type NoteReferenceInput } from '../utils/noteReference';

interface ReferenceNoteProps extends NoteReferenceInput {
  relation?: string;
  reason?: string;
  onOpen?: () => void;
}

export default function ReferenceNote({
  title,
  content,
  excerpt,
  contentText,
  contentJson,
  sourceType,
  imageCount,
  firstImageSrc,
  createdAt,
  matchType,
  createdAtSource,
  relation,
  reason,
  onOpen,
}: ReferenceNoteProps) {
  const display = noteReferenceDisplay({ title, content, excerpt, contentText, contentJson, sourceType, imageCount, firstImageSrc, createdAt, matchType, createdAtSource });
  return (
    <button
      type="button"
      className={styles.reference}
      onClick={onOpen}
      disabled={!onOpen}
    >
      <span className={styles.referenceTitle}>
        <FileText size={16} aria-hidden="true" />
        <span>{display.label}</span>
        {onOpen && (
          <ArrowUpRight
            size={15}
            className={styles.openIcon}
            aria-hidden="true"
          />
        )}
      </span>
      {(display.secondary || display.firstImageSrc) && <span className={styles.excerpt}>
        {display.firstImageSrc && <img src={display.firstImageSrc} alt="笔记首图" width={64} height={64} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, verticalAlign: 'middle', marginRight: 8 }} />}
        {display.secondary}
      </span>}
      {(display.dateLabel || relation) && <span className={styles.referenceMeta}>
        {display.dateLabel && <time dateTime={createdAt instanceof Date ? createdAt.toISOString() : createdAt}>{display.dateLabel}</time>}
        {relation && <span>{relation}</span>}
      </span>}
      {reason && (
        <span className={styles.reason}>
          <span className={styles.reasonLabel}>关联理由</span>
          <span>{reason}</span>
        </span>
      )}
    </button>
  );
}
