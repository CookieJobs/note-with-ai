import { mapUserProfileToBackgroundTheme } from './profileBackgroundTheme'
import type { LegacyProfileDto } from '../../services/profileService'

const samples: Array<{ name: string; profile?: LegacyProfileDto }> = [
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
