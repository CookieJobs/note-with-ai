/* Deterministic frost positions keep hydration stable and each note distinct. */
const FROST_CORNERS = [
  { width: 24, height: 12 },
  { width: 40, height: 22 },
  { width: 56, height: 29 },
  { width: 70, height: 37 },
  { width: 85, height: 45 },
  { width: 100, height: 54 },
];

export const MAX_FROST_HEIGHT = FROST_CORNERS[FROST_CORNERS.length - 1].height;

export function frostCorner(layers: number) {
  return FROST_CORNERS[Math.min(layers, FROST_CORNERS.length - 1)] ?? FROST_CORNERS[0];
}

export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function randomSequence(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function frostCrystals(seed: number, layers: number) {
  const appearance = randomSequence(seed);
  const drift = randomSequence(seed ^ Math.imul(layers + 1, 0x9e3779b9));
  const corner = frostCorner(layers);

  return Array.from({ length: 11 }, (_, index) => {
    const size = 4 + appearance() * 7;
    const brightness = .36 + appearance() * .42;
    const anchorRight = .11 + appearance() * .65;
    const anchorTop = .17 + appearance() * .62;
    const angle = appearance() * 44 - 22;
    return {
      size,
      right: corner.width * (anchorRight + (drift() - .5) * .038),
      top: corner.height * (anchorTop + (drift() - .5) * .045),
      rotation: angle + (drift() - .5) * 12,
      opacity: layers > 0 && index < 6 + layers ? brightness : 0,
    };
  });
}
