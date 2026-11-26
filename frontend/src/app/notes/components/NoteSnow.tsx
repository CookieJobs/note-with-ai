'use client';
import { memo, type CSSProperties } from 'react';
import { frostCorner, frostCrystals, MAX_FROST_HEIGHT } from '../utils/frostArt';
import styles from './NoteSnow.module.scss';

const crystalBranch = 'M12 2v20 M9 5l3 3 3-3 M9 19l3-3 3 3';

function NoteSnow({ layers, seed }: { layers: number; seed: number }) {
  const corner = frostCorner(layers);
  return (
    <span className={styles.corner} data-frost-corner={layers} aria-hidden="true" style={{ height: MAX_FROST_HEIGHT }}>
      <span
        className={styles.haze}
        style={{ width: `${corner.width}%`, height: corner.height, opacity: layers > 0 ? 1 : 0 }}
      />
      {frostCrystals(seed, layers).map((crystal, index) => (
        <svg
          key={index}
          data-frost-crystal={index}
          className={styles.crystal}
          width={crystal.size}
          height={crystal.size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
          style={{
            right: `${crystal.right}%`,
            top: crystal.top,
            opacity: crystal.opacity,
            '--frost-angle': `${crystal.rotation}deg`,
            '--frost-delay': `${(index % 4) * 14}ms`,
          } as CSSProperties}
        >
          <path d={crystalBranch} />
          <path d={crystalBranch} transform="rotate(60 12 12)" />
          <path d={crystalBranch} transform="rotate(120 12 12)" />
        </svg>
      ))}
    </span>
  );
}

export default memo(NoteSnow);
