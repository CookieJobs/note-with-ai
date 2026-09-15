// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const variables = readFileSync(new URL('./_variables.scss', import.meta.url), 'utf8');
const globals = readFileSync(new URL('./globals.scss', import.meta.url), 'utf8');
const inspirationStyles = readFileSync(new URL('../app/inspiration/inspiration.module.scss', import.meta.url), 'utf8');
const publishStyles = readFileSync(new URL('../app/publish/publish.module.scss', import.meta.url), 'utf8');
const chatStyles = readFileSync(new URL('../app/chat/chat.module.scss', import.meta.url), 'utf8');
const memoryPage = readFileSync(new URL('../app/memory/page.tsx', import.meta.url), 'utf8');
const topNavigationStyles = readFileSync(new URL('../components/TopNavigation.module.scss', import.meta.url), 'utf8');
const floatingComposeStyles = readFileSync(new URL('../app/notes/styles/floating-compose.module.scss', import.meta.url), 'utf8');
const richEditorStyles = readFileSync(new URL('../app/notes/styles/rich-editor.module.scss', import.meta.url), 'utf8');
const modernNoteCard = readFileSync(new URL('../app/notes/components/ModernNoteCard.tsx', import.meta.url), 'utf8');
const richTextBubbleMenu = readFileSync(new URL('../app/notes/components/RichTextBubbleMenu.tsx', import.meta.url), 'utf8');
const careAssistantPanel = readFileSync(new URL('../components/CareAssistantPanel.tsx', import.meta.url), 'utf8');
const profileStyles = readFileSync(new URL('../app/profile/profile.module.scss', import.meta.url), 'utf8');
const authStyles = readFileSync(new URL('../app/auth/auth.module.scss', import.meta.url), 'utf8');
const reducedMotionUrl = new URL('./reduced-motion.scss', import.meta.url);
const reducedMotion = existsSync(reducedMotionUrl) ? readFileSync(reducedMotionUrl, 'utf8') : '';
const declaredCoreRouteMatrix = ['Notes', 'Chat', 'Memory', 'Inspiration', 'Profile', 'Publish', 'Auth'] as const;
const directCoreRoutePageSources = {
  Notes: ['../app/notes/page.tsx'],
  Chat: ['../app/chat/page.tsx'],
  Memory: ['../app/memory/page.tsx'],
  Inspiration: ['../app/inspiration/page.tsx'],
  Profile: ['../app/profile/page.tsx'],
  Publish: ['../app/publish/page.tsx', '../app/publish/select/page.tsx', '../app/publish/[noteId]/page.tsx'],
  Auth: ['../app/auth/page.tsx'],
} as const satisfies Record<(typeof declaredCoreRouteMatrix)[number], readonly string[]>;
const directCoreRoutePageSourcePaths = Object.values(directCoreRoutePageSources).flat();
const coreProductStyleSourcePaths = [
  './globals.scss',
  '../app/auth/auth.module.scss',
  '../app/inspiration/inspiration.module.scss',
  '../app/memory/memory.module.scss',
  '../app/publish/publish.module.scss',
  '../app/chat/chat.module.scss',
  '../app/profile/profile.module.scss',
  '../app/notes/styles/layout.module.scss',
  '../app/notes/styles/note-card.module.scss',
  '../app/notes/styles/floating-compose.module.scss',
  '../app/notes/styles/rich-editor.module.scss',
  '../components/TopNavigation.module.scss',
  '../components/ChatMessage.module.scss',
  '../components/RelatedNoteCard.module.scss',
  ...directCoreRoutePageSourcePaths,
  '../app/notes/components/FloatingQuickCompose.tsx',
  '../components/ChatInputArea.tsx',
  '../components/CareAssistantPanel.tsx',
  '../components/ChatRelatedNotesPanel.tsx',
  '../components/RelatedNoteCard.tsx',
  '../app/notes/components/UrlPopover.tsx',
] as const;
const rawColorLiteral = /#[\da-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
const rawPaletteUtility = /(?:^|[\s"'`])(?:(?:[a-z-]+):)*(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|caret|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{1,3})?(?:\/\d+)?\b/g;
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

function blockFor(selector: ':root' | ':root.dark') {
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

function sourceFor(path: string) {
  return path === './globals.scss' ? globals : readFileSync(new URL(path, import.meta.url), 'utf8');
}

function rawColorMatches(source: string) {
  return [...source.matchAll(rawColorLiteral)].map((match) => match[0]);
}

function rawPaletteUtilityMatches(source: string) {
  return [...source.matchAll(rawPaletteUtility)].map((match) => match[0].trim());
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
    const darkTokens = blockFor(':root.dark');

    lightSemanticTokens.forEach((token) => expect(tokenValue(lightTokens, token)).toBeTruthy());
    darkSemanticTokens.forEach((token) => expect(tokenValue(darkTokens, token)).toBeTruthy());
  });

  it('applies dark semantic tokens with enough specificity to override the light :root tokens', () => {
    expect(variables).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?:root:not\(\.light\)\s*\{/);
    expect(variables).not.toContain(':where(:root:not(.light))');

    const systemDarkStart = variables.indexOf('@media (prefers-color-scheme: dark)');
    const manualDarkStart = variables.indexOf('\n:root.dark {', systemDarkStart);
    const systemDarkBlock = variables.slice(systemDarkStart, manualDarkStart);

    expect(manualDarkStart).toBeGreaterThan(systemDarkStart);
    darkSemanticTokens.forEach((token) => expect(tokenValue(systemDarkBlock, token)).toBeTruthy());
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

  it('honors reduced-motion preferences without unrestricted transitions in every business style', () => {
    expect(reducedMotion).toContain('@media (prefers-reduced-motion: reduce)');
    expect(reducedMotion).toContain('animation-duration: 0.01ms !important');
    expect(reducedMotion).toContain('transition-duration: 0.01ms !important');
    for (const path of coreProductStyleSourcePaths) {
      const source = sourceFor(path);
      expect(source, `${path} must not use transition: all`).not.toMatch(/transition\s*:\s*all\b/);
    }
  });

  it('keeps the approved core-route SCSS and TSX sources on semantic or component tokens', () => {
    for (const path of coreProductStyleSourcePaths) {
      const matches = rawColorMatches(sourceFor(path));

      expect(matches, `${path} should not introduce a raw business color literal`).toEqual([]);
    }
  });

  it('lists every direct page source in the declared seven-route matrix', () => {
    expect(Object.keys(directCoreRoutePageSources)).toEqual(declaredCoreRouteMatrix);
    expect(directCoreRoutePageSources.Publish).toEqual([
      '../app/publish/page.tsx', '../app/publish/select/page.tsx', '../app/publish/[noteId]/page.tsx',
    ]);
    expect(coreProductStyleSourcePaths).toEqual(expect.arrayContaining(directCoreRoutePageSourcePaths));
  });

  it.each([
    ['hex', '<span style={{ color: "#123abc" }} />', '#123abc'],
    ['rgb', '<span style={{ color: "rgb(1, 2, 3)" }} />', 'rgb(1, 2, 3)'],
    ['rgba', '<span style={{ color: "rgba(1, 2, 3, 0.4)" }} />', 'rgba(1, 2, 3, 0.4)'],
    ['hsl', '<span style={{ color: "hsl(220 60% 50%)" }} />', 'hsl(220 60% 50%)'],
  ])('detects a raw %s color literal in TSX source', (_kind, source, literal) => {
    expect(rawColorMatches(source)).toEqual([literal]);
  });

  it.each([
    ['base palette', 'bg-slate-900/20', 'bg-slate-900/20'],
    ['state palette', 'focus:ring-blue-500', 'focus:ring-blue-500'],
    ['gradient palette', 'from-gray-50 via-white to-white', 'from-gray-50'],
  ])('detects a raw %s Tailwind utility', (_kind, source, expected) => {
    expect(rawPaletteUtilityMatches(source)).toContain(expected);
  });

  it('keeps CareAssistantPanel and UrlPopover on semantic or component palette tokens', () => {
    expect(rawPaletteUtilityMatches(careAssistantPanel)).toEqual([]);
    expect(rawPaletteUtilityMatches(sourceFor('../app/notes/components/UrlPopover.tsx'))).toEqual([]);
  });

  it('keeps named primary route controls at least 44px tall', () => {
    expect(inspirationStyles).toMatch(/\.primary\s*\{[^}]*min-height:\s*44px/);
    expect(publishStyles).toMatch(/\.primary\s*\{[^}]*min-height:\s*44px/);
    expect(memoryPage).toMatch(/<Button variant="default" size="lg"[^>]*generateButton/);
    expect(memoryPage).toMatch(/<Button variant="default" size="lg"[^>]*>.*这是准确的/);
    expect(memoryPage).toMatch(/<Button variant="default" size="lg"[^>]*memoryPrimaryAction[^>]*>.*保存修改/);
    expect(chatStyles).toMatch(/\.relatedNotesFab\s*\{[^}]*height:\s*44px/);
  });

  it('keeps the live-matrix anchors and controls at the product 44px target', () => {
    expect(topNavigationStyles).toMatch(/\.logo\s*\{[^}]*min-height:\s*44px/);
    expect(floatingComposeStyles).toMatch(/\.floatingComposeBarInner\s*\{[^}]*min-height:\s*44px/);
    expect(modernNoteCard).toContain('!w-11 !h-11');
    expect(careAssistantPanel).toContain('h-11 w-11');
    expect(careAssistantPanel).toContain('min-h-11 min-w-11');
    expect(inspirationStyles).toMatch(/\.actions a, \.actions button\s*\{[^}]*min-height:\s*44px/);
    expect(inspirationStyles).toMatch(/\.consent\s*\{[^}]*min-height:\s*44px/);
    expect(profileStyles).toMatch(/\.btnOutlineSm, \.btnGhostSm, \.btnCancel\s*\{[^}]*min-height:\s*2\.75rem/);
    expect(profileStyles).toMatch(/\.aiGroupToggle, \.modalClose\s*\{[^}]*min-width:\s*2\.75rem[^}]*min-height:\s*2\.75rem/);
    expect(richEditorStyles).toMatch(/\.richToolbarBtn\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
    expect(richTextBubbleMenu).toContain('w-11 h-11');
  });

  it('keeps analogous compact controls in the approved route matrix at 44px', () => {
    expect(authStyles).toMatch(/\.modeTab\s*\{[^}]*min-height:\s*44px/);
    expect(authStyles).toMatch(/\.passwordToggle\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
    expect(authStyles).toMatch(/\.switchModeLink,\s*\.forgotPassword\s*\{[^}]*min-height:\s*44px/);
    expect(publishStyles).toMatch(/\.card a, \.card button, \.preview button\s*\{[^}]*min-height:\s*44px/);
    expect(memoryPage).toContain('variant="link" size="lg" className={`${styles.evidenceToggle} px-3`}');
    expect(floatingComposeStyles).toMatch(/\.composeCancelBtn\s*\{[^}]*min-height:\s*44px/);
    expect(floatingComposeStyles).toMatch(/\.composeSaveBtn\s*\{[^}]*min-height:\s*44px/);
    expect(floatingComposeStyles).toMatch(/\.composeDiscardBtn\s*\{[^}]*min-height:\s*44px/);
    expect(chatStyles).toMatch(/\.relatedNotesClose\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
    expect(chatStyles).toMatch(/\.confirmButtons\s*\{[\s\S]*?button\s*\{[^}]*min-height:\s*44px/);
  });

});
