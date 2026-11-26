import { describe, expect, it } from 'vitest';
import { MAX_FROST_HEIGHT, frostCorner, frostCrystals, hashSeed } from './frostArt';

describe('corner frost', () => {
  it('gives each note a stable initial arrangement', () => {
    const seed = hashSeed('note-a');
    expect(frostCrystals(seed, 5)).toEqual(frostCrystals(seed, 5));
    expect(frostCrystals(seed, 5)).not.toEqual(frostCrystals(hashSeed('note-b'), 5));
  });

  it('keeps each move within a small drift from the previous crystal position', () => {
    for (const noteId of ['note-a', 'note-b', 'note-c']) {
      const seed = hashSeed(noteId);
      for (let layers = 5; layers > 0; layers -= 1) {
        const previous = frostCrystals(seed, layers);
        const next = frostCrystals(seed, layers - 1);
        next.forEach((crystal, index) => {
          expect(Math.abs(crystal.right - previous[index].right)).toBeLessThan(15);
          expect(Math.abs(crystal.top - previous[index].top)).toBeLessThan(12);
          expect(Math.abs(crystal.rotation - previous[index].rotation)).toBeLessThanOrEqual(12);
        });
      }
    }
  });

  it('assigns each crystal a new destination inside the smaller corner at each layer', () => {
    const seed = hashSeed('note-a');
    for (let layers = 5; layers > 0; layers -= 1) {
      const corner = frostCorner(layers);
      const nextCorner = frostCorner(layers - 1);
      const before = frostCrystals(seed, layers);
      const after = frostCrystals(seed, layers - 1);
      expect(nextCorner.width).toBeLessThan(corner.width);
      expect(nextCorner.height).toBeLessThan(corner.height);
      expect(after).toHaveLength(before.length);
      before.forEach((crystal, index) => {
        const moved = after[index];
        expect(moved.size).toBe(crystal.size);
        expect([moved.right, moved.top]).not.toEqual([crystal.right, crystal.top]);
        expect(moved.right).toBeGreaterThanOrEqual(0);
        expect(moved.right).toBeLessThanOrEqual(nextCorner.width);
        expect(moved.top).toBeGreaterThanOrEqual(0);
        expect(moved.top).toBeLessThanOrEqual(nextCorner.height);
        expect(moved.top).toBeLessThanOrEqual(MAX_FROST_HEIGHT);
      });
    }
    expect(frostCrystals(seed, 0).every(crystal => crystal.opacity === 0)).toBe(true);
  });
});
