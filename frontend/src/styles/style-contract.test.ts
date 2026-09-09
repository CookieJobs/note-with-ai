// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const variables = readFileSync(new URL('./_variables.scss', import.meta.url), 'utf8');
const globals = readFileSync(new URL('./globals.scss', import.meta.url), 'utf8');
const reducedMotionUrl = new URL('./reduced-motion.scss', import.meta.url);
const reducedMotion = existsSync(reducedMotionUrl) ? readFileSync(reducedMotionUrl, 'utf8') : '';

describe('style foundation contract', () => {
  it('defines light and dark semantic color, radius, focus, and motion tokens', () => {
    expect(variables).toContain(':root');
    expect(variables).toContain('.dark');

    [
      '--color-text-primary:',
      '--color-surface-page:',
      '--color-border-subtle:',
      '--color-action-primary:',
      '--color-status-success:',
      '--focus-ring:',
      '--radius-sm:',
      '--motion-duration-fast:',
    ].forEach((token) => expect(variables).toContain(token));
  });

  it('uses the project font variable before Chinese-capable fallbacks', () => {
    expect(globals).toMatch(
      /font-family:\s*var\(--font-sans\),\s*"PingFang SC",\s*"Noto Sans CJK SC",\s*"Microsoft YaHei",\s*sans-serif;/,
    );
  });

  it('provides a visible reusable focus ring', () => {
    expect(globals).toMatch(/\.focus-ring\s*\{/);
    expect(globals).toContain('var(--focus-ring)');
  });

  it('honors reduced-motion preferences without unrestricted transitions', () => {
    expect(reducedMotion).toContain('@media (prefers-reduced-motion: reduce)');
    expect(`${variables}\n${globals}\n${reducedMotion}`).not.toMatch(/transition\s*:\s*all\b/);
  });
});
