// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const variables = readFileSync(new URL('./_variables.scss', import.meta.url), 'utf8');
const globals = readFileSync(new URL('./globals.scss', import.meta.url), 'utf8');
const inspirationStyles = readFileSync(new URL('../app/inspiration/inspiration.module.scss', import.meta.url), 'utf8');
const publishStyles = readFileSync(new URL('../app/publish/publish.module.scss', import.meta.url), 'utf8');
const chatStyles = readFileSync(new URL('../app/chat/chat.module.scss', import.meta.url), 'utf8');
const memoryPage = readFileSync(new URL('../app/memory/page.tsx', import.meta.url), 'utf8');
const reducedMotionUrl = new URL('./reduced-motion.scss', import.meta.url);
const reducedMotion = existsSync(reducedMotionUrl) ? readFileSync(reducedMotionUrl, 'utf8') : '';
const coreRouteStyles = [
  '../app/inspiration/inspiration.module.scss',
  '../app/memory/memory.module.scss',
  '../app/publish/publish.module.scss',
  '../app/chat/chat.module.scss',
  '../app/notes/styles/layout.module.scss',
  '../app/notes/styles/note-card.module.scss',
] as const;
const rawHexAllowlist = [
  {
    path: '../app/notes/styles/layout.module.scss',
    selector: /^\.container\b/,
    property: /^background$/,
    value: /(?:radial|linear)-gradient\(/,
    purpose: 'the notes workspace atmosphere resolver output',
  },
  {
    path: '../app/notes/styles/note-card.module.scss',
    selector: /^\.workspaceOverlayPanel\b/,
    property: /^background$/,
    value: /(?:radial|linear)-gradient\(/,
    purpose: 'editor atmosphere output',
  },
  {
    path: '../app/notes/styles/note-card.module.scss',
    selector: /:global\(\.hljs(?:[-\w]*)?\)/,
    property: /^color$/,
    value: /#[\da-f]{3,8}\b/i,
    purpose: 'temporary editor syntax output',
  },
] as const;
const lightSemanticTokens = [
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-text-inverse',
  '--color-surface-page',
  '--color-surface-raised',
  '--color-surface-sunken',
  '--color-surface-overlay',
  '--color-border-subtle',
  '--color-border-default',
  '--color-border-strong',
  '--color-action-primary',
  '--color-action-primary-hover',
  '--color-action-primary-active',
  '--color-action-secondary',
  '--color-action-secondary-hover',
  '--color-action-danger',
  '--color-status-success',
  '--color-status-success-surface',
  '--color-status-warning',
  '--color-status-warning-surface',
  '--color-status-error',
  '--color-status-error-surface',
  '--color-status-info',
  '--color-status-info-surface',
  '--focus-ring',
  '--radius-sm',
  '--motion-duration-fast',
];
const darkSemanticTokens = lightSemanticTokens.filter(
  (token) => !token.startsWith('--radius-') && !token.startsWith('--motion-'),
);

function blockFor(selector: ':root' | '.dark') {
  const start = variables.indexOf(`${selector} {`);
  const end = variables.indexOf('\n}', start);

  return variables.slice(start, end);
}

function tokenValue(block: string, token: string) {
  const value = block.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1];

  if (!value) {
    throw new Error(`Missing ${token}`);
  }

  return value;
}

function parseColor(value: string) {
  const hex = value.match(/#([\da-f]{6})/i)?.[1];
  if (hex) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      1,
    ] as const;
  }

  const rgba = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
  if (!rgba) {
    throw new Error(`Unsupported color value: ${value}`);
  }

  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4] ?? 1)] as const;
}

function declarationFor(source: string, index: number) {
  const openBrace = source.lastIndexOf('{', index);
  const declarationStart = Math.max(source.lastIndexOf(';', index), openBrace) + 1;
  const nextSemicolon = source.indexOf(';', index);
  const nextBrace = source.indexOf('}', index);
  const declarationEnd = Math.min(
    nextSemicolon === -1 ? source.length : nextSemicolon,
    nextBrace === -1 ? source.length : nextBrace,
  );
  const declaration = source.slice(declarationStart, declarationEnd).trim();
  const [property, ...valueParts] = declaration.split(':');
  const selectorStart = Math.max(source.lastIndexOf('}', openBrace), source.lastIndexOf('{', openBrace - 1)) + 1;

  return {
    property: property?.trim() ?? '',
    value: valueParts.join(':').trim(),
    selector: source.slice(selectorStart, openBrace).trim(),
  };
}

function hasAllowedRawHex(path: string, source: string, index: number) {
  const declaration = declarationFor(source, index);

  return rawHexAllowlist.some(
    (allowance) =>
      allowance.path === path &&
      allowance.selector.test(declaration.selector) &&
      allowance.property.test(declaration.property) &&
      allowance.value.test(declaration.value),
  );
}

function contrastRatio(first: readonly number[], second: readonly number[]) {
  const composite = (foreground: readonly number[], background: readonly number[]) =>
    foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]));
  const luminance = (color: readonly number[]) =>
    composite(color, [255, 255, 255, 1]).reduce(
      (total, channel, index) => {
        const normalized = channel / 255;
        const linear =
          normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;

        return total + [0.2126, 0.7152, 0.0722][index] * linear;
      },
      0,
    );
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);

  return (lighter + 0.05) / (darker + 0.05);
}

describe('style foundation contract', () => {
  it('defines light and dark semantic color, radius, focus, and motion tokens', () => {
    const lightTokens = blockFor(':root');
    const darkTokens = blockFor('.dark');

    lightSemanticTokens.forEach((token) => expect(tokenValue(lightTokens, token)).toBeTruthy());
    darkSemanticTokens.forEach((token) => expect(tokenValue(darkTokens, token)).toBeTruthy());
  });

  it('keeps the light focus indicator at 3:1 contrast against a raised surface', () => {
    const lightTokens = blockFor(':root');

    expect(
      contrastRatio(
        parseColor(tokenValue(lightTokens, '--focus-ring')),
        parseColor(tokenValue(lightTokens, '--color-surface-raised')),
      ),
    ).toBeGreaterThanOrEqual(3);
  });

  it('keeps light tertiary text at 4.5:1 contrast against the page surface', () => {
    const lightTokens = blockFor(':root');

    expect(
      contrastRatio(
        parseColor(tokenValue(lightTokens, '--color-text-tertiary')),
        parseColor(tokenValue(lightTokens, '--color-surface-page')),
      ),
    ).toBeGreaterThanOrEqual(4.5);
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

  it('keeps business route colors on semantic tokens', () => {
    for (const path of coreRouteStyles) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      const rawHexMatches = [...source.matchAll(/#[\da-f]{3,8}\b/gi)].filter(
        (match) => !hasAllowedRawHex(path, source, match.index ?? 0),
      );

      expect(rawHexMatches, `${path} should not introduce a business-page hex literal`).toEqual([]);
    }
  });

  it('keeps named primary route controls at least 44px tall', () => {
    expect(inspirationStyles).toMatch(/\.primary\s*\{[^}]*min-height:\s*44px/);
    expect(publishStyles).toMatch(/\.primary\s*\{[^}]*min-height:\s*44px/);
    expect(memoryPage).toMatch(/<Button variant="default" size="lg"[^>]*generateButton/);
    expect(memoryPage).toMatch(/<Button variant="default" size="lg"[^>]*>.*这是准确的/);
    expect(chatStyles).toMatch(/\.relatedNotesFab\s*\{[^}]*height:\s*44px/);
  });

  it('does not let a raw color piggyback on an allowed atmosphere declaration', () => {
    const source = '.container { background: radial-gradient(circle, #123456, transparent); color: #654321; }';
    const allowedGradientIndex = source.indexOf('#123456');
    const unrelatedColorIndex = source.indexOf('#654321');

    expect(hasAllowedRawHex('../app/notes/styles/layout.module.scss', source, allowedGradientIndex)).toBe(true);
    expect(hasAllowedRawHex('../app/notes/styles/layout.module.scss', source, unrelatedColorIndex)).toBe(false);
  });

  it('does not let a non-syntax declaration piggyback on an hljs selector', () => {
    const source = ':global(.hljs) { color: #123456; border-color: #654321; }';
    const syntaxColorIndex = source.indexOf('#123456');
    const nonSyntaxColorIndex = source.indexOf('#654321');

    expect(hasAllowedRawHex('../app/notes/styles/note-card.module.scss', source, syntaxColorIndex)).toBe(true);
    expect(hasAllowedRawHex('../app/notes/styles/note-card.module.scss', source, nonSyntaxColorIndex)).toBe(false);
  });
});
