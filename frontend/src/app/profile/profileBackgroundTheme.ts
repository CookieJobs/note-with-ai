import type { UserProfile } from '../../services/feedService'

export type ProfileBackgroundThemeId =
  | 'tech-cool' | 'kid-warm' | 'nature-forest' | 'night-purple'
  | 'paper-beige' | 'neon-trend' | 'hash-generated' | 'default'

/** A source for decorative personalization, never a page colour scheme. */
export type ProfileBackgroundTheme = { id: ProfileBackgroundThemeId; background: string }

export type AtmosphereTokens = { accent: string; soft: string; glow: string }

type TextSignal = { text: string; weight: number }
type Hsl = { hue: number; saturation: number; lightness: number }

const INDIGO_FALLBACK: AtmosphereTokens = {
  accent: 'hsl(231 64% 52%)',
  soft: 'hsl(231 56% 92% / 0.72)',
  glow: 'hsl(231 60% 62% / 0.24)',
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
const normalize = (value: string) => value.trim().toLowerCase()

const fnv1a32 = (input: string) => {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

const stableSeedFromProfile = (userProfile?: UserProfile, extraSeed?: string) => {
  const interestPart = (userProfile?.interests || []).slice()
    .sort((first, second) => normalize(first.topic).localeCompare(normalize(second.topic)) || second.score - first.score)
    .map((interest) => `${normalize(interest.topic)}:${Math.round(interest.score * 1000)}`).join('|')
  const expertisePart = (userProfile?.expertise || []).slice()
    .sort((first, second) => normalize(first.area).localeCompare(normalize(second.area)) || normalize(first.level).localeCompare(normalize(second.level)))
    .map((expertise) => `${normalize(expertise.area)}:${normalize(expertise.level)}`).join('|')
  return [interestPart, expertisePart, normalize(userProfile?.summary || ''), normalize(extraSeed || '')].filter(Boolean).join('||')
}

const buildSignals = (userProfile?: UserProfile): TextSignal[] => {
  const signals: TextSignal[] = []
  for (const interest of (userProfile?.interests || []).slice().sort((first, second) => second.score - first.score || normalize(first.topic).localeCompare(normalize(second.topic)))) {
    const text = normalize(interest.topic)
    if (text) signals.push({ text, weight: 1.3 + clamp(interest.score, 0, 1) * 2.2 })
  }
  const summary = normalize(userProfile?.summary || '')
  if (summary) signals.push({ text: summary, weight: 1 })
  for (const expertise of (userProfile?.expertise || []).slice().sort((first, second) => normalize(first.area).localeCompare(normalize(second.area)))) {
    const text = normalize(expertise.area)
    if (text) signals.push({ text, weight: 1.15 })
  }
  return signals
}

type StyleRule = { id: Exclude<ProfileBackgroundThemeId, 'hash-generated' | 'default'>; keywords: string[]; color: string }

const STYLE_RULES: StyleRule[] = [
  { id: 'tech-cool', keywords: ['ai', 'aigc', 'llm', 'rag', 'agent', 'openai', 'deepseek', 'qwen', '编程', '代码', '程序', '软件', '开发', '工程', '算法', '数据', '开源', 'linux', '机器学习', '深度学习'], color: 'hsl(220 56% 53%)' },
  { id: 'kid-warm', keywords: ['日记', '校园', '成长', '手工', '绘本', '可爱', '童话', '亲子', '宝宝', '小朋友', '旅行', '美食', '烘焙'], color: 'hsl(24 60% 54%)' },
  { id: 'nature-forest', keywords: ['自然', '森林', '植物', '园艺', '露营', '徒步', '登山', '户外', '动物', '生态', '环保', '海洋', '瑜伽', '冥想'], color: 'hsl(142 46% 46%)' },
  { id: 'night-purple', keywords: ['夜', '夜色', '星', '星空', '月', '宇宙', '天文', '科幻', '哲学', '写作', '诗', '音乐', '电影', '艺术', '灵感'], color: 'hsl(267 52% 54%)' },
  { id: 'paper-beige', keywords: ['读书', '阅读', '笔记', '写作', '手账', '整理', '复盘', '学习', '论文', '研究', '历史', '人文', '心理学'], color: 'hsl(38 44% 50%)' },
  { id: 'neon-trend', keywords: ['潮流', '街头', '霓虹', '赛博', '朋克', '电玩', '游戏', '二次元', '设计', 'ui', 'ux', '视觉', '摄影', '剪辑'], color: 'hsl(309 58% 54%)' },
]

export const defaultProfileBackgroundTheme: ProfileBackgroundTheme = { id: 'default', background: 'hsl(231 64% 52%)' }

const matchByKeywords = (signals: TextSignal[]): ProfileBackgroundTheme | null => {
  let bestRule: StyleRule | null = null
  let bestScore = 0
  for (const rule of STYLE_RULES) {
    const score = signals.reduce((total, signal) => total + rule.keywords.reduce(
      (ruleTotal, keyword) => ruleTotal + (signal.text.includes(normalize(keyword)) ? signal.weight : 0), 0), 0)
    if (score > bestScore) { bestScore = score; bestRule = rule }
  }
  return bestRule ? { id: bestRule.id, background: bestRule.color } : null
}

const hashGeneratedTheme = (seed: string): ProfileBackgroundTheme => ({
  id: 'hash-generated', background: `hsl(${fnv1a32(seed) % 360} 52% 52%)`,
})

export const mapUserProfileToBackgroundTheme = (userProfile?: UserProfile, options?: { seed?: string }): ProfileBackgroundTheme => {
  const matched = matchByKeywords(buildSignals(userProfile))
  if (matched) return matched
  const seed = stableSeedFromProfile(userProfile, options?.seed)
  return seed ? hashGeneratedTheme(seed) : defaultProfileBackgroundTheme
}

const hslFromRgb = (red: number, green: number, blue: number): Hsl => {
  const r = red / 255; const g = green / 255; const b = blue / 255
  const maximum = Math.max(r, g, b); const minimum = Math.min(r, g, b); const delta = maximum - minimum
  const lightness = (maximum + minimum) / 2
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  const hue = delta === 0 ? 231 : 60 * (((maximum === r ? (g - b) / delta : maximum === g ? (b - r) / delta + 2 : (r - g) / delta + 4) + 6) % 6)
  return { hue: Math.round(hue), saturation: Math.round(saturation * 100), lightness: Math.round(lightness * 100) }
}

const parseHex = (value: string): Hsl | null => {
  const match = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim())
  if (!match) return null
  const hex = match[1].length === 3 ? match[1].split('').map((part) => `${part}${part}`).join('') : match[1].slice(0, 6)
  return hslFromRgb(Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16))
}

const parseHsl = (value: string): Hsl | null => {
  const match = /^hsl\(\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(\d+(?:\.\d+)?)%\s*(?:,|\s)\s*(\d+(?:\.\d+)?)%(?:\s*(?:\/|,)\s*[\d.]+%?)?\s*\)$/i.exec(value.trim())
  if (!match) return null
  return { hue: ((Number(match[1]) % 360) + 360) % 360, saturation: Number(match[2]), lightness: Number(match[3]) }
}

const sourceColor = (theme: unknown): string | null => {
  if (!theme || typeof theme !== 'object') return null
  const candidate = theme as { id?: unknown; background?: unknown; cssValue?: unknown }
  if (candidate.id === 'default') return null
  if (typeof candidate.cssValue === 'string') return candidate.cssValue
  return typeof candidate.background === 'string' ? candidate.background : null
}

const parseSourceColor = (theme: unknown): Hsl | null => {
  const value = sourceColor(theme)
  return value ? parseHex(value) || parseHsl(value) : null
}

/** Converts untrusted theme input into decorative colours, never content tokens. */
export const resolveProfileAtmosphere = (theme: unknown): AtmosphereTokens => {
  const source = parseSourceColor(theme)
  if (!source || !Number.isFinite(source.hue) || !Number.isFinite(source.saturation) || !Number.isFinite(source.lightness)) return INDIGO_FALLBACK
  const hue = Math.round(clamp(source.hue, 0, 359))
  const isVeryDark = source.lightness < 20
  const saturation = Math.round(isVeryDark ? 38 : clamp(source.saturation, 38, 68))
  const lightness = Math.round(clamp(source.lightness, 45, 62))
  return {
    accent: `hsl(${hue} ${saturation}% ${lightness}%)`,
    soft: `hsl(${hue} ${Math.max(38, saturation - 12)}% 92% / 0.72)`,
    glow: `hsl(${hue} ${Math.max(42, saturation - 8)}% 62% / 0.24)`,
  }
}
