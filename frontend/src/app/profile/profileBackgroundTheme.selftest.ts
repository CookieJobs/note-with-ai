import { describe, expect, it } from 'vitest'
import {
  defaultProfileBackgroundTheme,
  mapUserProfileToBackgroundTheme,
  resolveProfileAtmosphere,
} from './profileBackgroundTheme'
import type { UserProfile } from '../../services/feedService'

const samples: Array<{ name: string; profile?: UserProfile }> = [
  {
    name: 'tech',
    profile: {
      interests: [
        { topic: 'AI', score: 0.92 },
        { topic: '编程', score: 0.86 },
      ],
      summary: '喜欢研究机器学习与系统工程，关注开源生态。',
      expertise: [{ area: 'Software Engineering', level: 'Advanced' }],
    },
  },
  {
    name: 'kid',
    profile: {
      interests: [
        { topic: '日记', score: 0.9 },
        { topic: '绘本', score: 0.78 },
      ],
      summary: '记录校园生活与成长的点滴，喜欢手工与可爱风格。',
      expertise: [{ area: '写作', level: 'Intermediate' }],
    },
  },
  {
    name: 'empty',
    profile: {
      interests: [],
      summary: '',
      expertise: [],
    },
  },
]

export const __profileBackgroundThemeSelfTest = samples.map((s) => ({
  name: s.name,
  theme: mapUserProfileToBackgroundTheme(s.profile, { seed: s.name }),
}))

const indigoFallback = {
  accent: 'hsl(231 64% 52%)',
  soft: 'hsl(231 56% 92% / 0.72)',
  glow: 'hsl(231 60% 62% / 0.24)',
}

const readHsl = (color: string) => {
  const match = /^hsl\((\d+) (\d+)% (\d+)%/.exec(color)
  if (!match) throw new Error(`Expected bounded hsl color, received ${color}`)
  return { hue: Number(match[1]), saturation: Number(match[2]), lightness: Number(match[3]) }
}

describe('resolveProfileAtmosphere', () => {
  it('returns only safe indigo decoration tokens for the default theme', () => {
    expect(resolveProfileAtmosphere(defaultProfileBackgroundTheme)).toEqual(indigoFallback)
    expect(Object.keys(resolveProfileAtmosphere(defaultProfileBackgroundTheme))).toEqual(['accent', 'soft', 'glow'])
  })

  it('keeps a light source theme inside the decorative contrast bounds', () => {
    const atmosphere = resolveProfileAtmosphere({ background: '#f8f8ff' })
    const accent = readHsl(atmosphere.accent)

    expect(accent.lightness).toBeGreaterThanOrEqual(45)
    expect(accent.lightness).toBeLessThanOrEqual(62)
    expect(accent.saturation).toBeGreaterThanOrEqual(38)
    expect(accent.saturation).toBeLessThanOrEqual(68)
  })

  it('clamps a saturated source theme before it reaches decoration', () => {
    const accent = readHsl(resolveProfileAtmosphere({ cssValue: 'hsl(0 100% 50%)' }).accent)

    expect(accent.hue).toBe(0)
    expect(accent.saturation).toBe(68)
    expect(accent.lightness).toBe(50)
  })

  it('falls back to indigo when a source theme is malformed', () => {
    expect(resolveProfileAtmosphere({ cssValue: 'linear-gradient(red, blue)' })).toEqual(indigoFallback)
    expect(resolveProfileAtmosphere({ cssValue: 'url(javascript:alert(1))' })).toEqual(indigoFallback)
  })

  it('raises a very dark source theme into the safe decorative range', () => {
    const accent = readHsl(resolveProfileAtmosphere({ background: '#000003' }).accent)

    expect(accent.lightness).toBe(45)
    expect(accent.saturation).toBe(38)
  })
})
