import type { UserProfile } from '../../services/feedService'

export type ProfileBackgroundThemeId =
  | 'tech-cool'
  | 'kid-warm'
  | 'nature-forest'
  | 'night-purple'
  | 'paper-beige'
  | 'neon-trend'
  | 'hash-generated'
  | 'default'

export type ProfileBackgroundTheme = {
  id: ProfileBackgroundThemeId
  background: string
}

type TextSignal = {
  text: string
  weight: number
}

const normalize = (s: string) => s.trim().toLowerCase()

const fnv1a32 = (input: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const hsla = (h: number, s: number, l: number, a: number) =>
  `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, ${a})`

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const stableSeedFromProfile = (userProfile?: UserProfile, extraSeed?: string) => {
  const interestPart = (userProfile?.interests || [])
    .slice()
    .sort((a, b) => normalize(a.topic).localeCompare(normalize(b.topic)) || b.score - a.score)
    .map((i) => `${normalize(i.topic)}:${Math.round(i.score * 1000)}`)
    .join('|')
  const expertisePart = (userProfile?.expertise || [])
    .slice()
    .sort((a, b) => normalize(a.area).localeCompare(normalize(b.area)) || normalize(a.level).localeCompare(normalize(b.level)))
    .map((e) => `${normalize(e.area)}:${normalize(e.level)}`)
    .join('|')
  const summaryPart = normalize(userProfile?.summary || '')
  return [interestPart, expertisePart, summaryPart, normalize(extraSeed || '')].filter(Boolean).join('||')
}

const buildSignals = (userProfile?: UserProfile): TextSignal[] => {
  const signals: TextSignal[] = []
  const interests = (userProfile?.interests || []).slice().sort((a, b) => b.score - a.score || normalize(a.topic).localeCompare(normalize(b.topic)))
  for (const i of interests) {
    const w = 1.3 + clamp(i.score, 0, 1) * 2.2
    const t = normalize(i.topic)
    if (t) signals.push({ text: t, weight: w })
  }
  const summary = normalize(userProfile?.summary || '')
  if (summary) signals.push({ text: summary, weight: 1.0 })
  const expertise = (userProfile?.expertise || []).slice().sort((a, b) => normalize(a.area).localeCompare(normalize(b.area)))
  for (const e of expertise) {
    const t = normalize(e.area)
    if (t) signals.push({ text: t, weight: 1.15 })
  }
  return signals
}

type StyleRule = {
  id: Exclude<ProfileBackgroundThemeId, 'hash-generated' | 'default'>
  keywords: string[]
  background: string
}

const STYLE_RULES: StyleRule[] = [
  {
    id: 'tech-cool',
    keywords: [
      'ai', 'aigc', 'llm', 'rag', 'agent', 'openai', 'deepseek', 'qwen',
      '编程', '代码', '程序', '软件', '开发', '工程', '算法', '数据结构',
      '科技', '数码', '硬件', '芯片', '开源', 'linux', 'mac', 'server',
      '机器学习', '深度学习', '神经网络', '计算机', '网络', '数据库',
    ],
    background:
      `radial-gradient(1200px 680px at 18% 6%, ${hsla(196, 60, 85, 0.65)} 0%, ${hsla(196, 60, 85, 0)} 62%),` +
      `radial-gradient(920px 620px at 86% 18%, ${hsla(222, 50, 86, 0.55)} 0%, ${hsla(222, 50, 86, 0)} 58%),` +
      `linear-gradient(180deg, ${hsla(210, 30, 96, 1)} 0%, ${hsla(216, 30, 94, 1)} 100%)`,
  },
  {
    id: 'kid-warm',
    keywords: [
      '日记', '校园', '成长', '手工', '绘本', '可爱', '童话', '涂鸦',
      '亲子', '宝宝', '小朋友', '幼儿', '老师', '作业', '考试',
      '快乐', '温暖', '治愈', '旅行', '美食', '烘焙', '甜品',
    ],
    background:
      `radial-gradient(1100px 640px at 20% 0%, ${hsla(30, 80, 85, 0.66)} 0%, ${hsla(30, 80, 85, 0)} 64%),` +
      `radial-gradient(900px 560px at 82% 22%, ${hsla(340, 60, 88, 0.48)} 0%, ${hsla(340, 60, 88, 0)} 58%),` +
      `linear-gradient(180deg, ${hsla(36, 40, 96, 1)} 0%, ${hsla(24, 40, 94, 1)} 100%)`,
  },
  {
    id: 'nature-forest',
    keywords: [
      '自然', '森林', '植物', '园艺', '露营', '徒步', '登山', '户外',
      '动物', '生态', '环保', '海洋', '河流', '山', '花', '树',
      '瑜伽', '冥想', '呼吸', '养生', '健康',
    ],
    background:
      `radial-gradient(1200px 700px at 16% 8%, ${hsla(142, 40, 85, 0.60)} 0%, ${hsla(142, 40, 85, 0)} 62%),` +
      `radial-gradient(980px 640px at 88% 14%, ${hsla(88, 40, 86, 0.52)} 0%, ${hsla(88, 40, 86, 0)} 58%),` +
      `linear-gradient(180deg, ${hsla(120, 20, 96, 1)} 0%, ${hsla(140, 20, 94, 1)} 100%)`,
  },
  {
    id: 'night-purple',
    keywords: [
      '夜', '夜色', '星', '星空', '月', '宇宙', '天文', '科幻',
      '哲学', '写作', '诗', '音乐', '电影', '艺术', '灵感',
      '焦虑', '情绪', '治愈', '自我', '思考',
    ],
    background:
      `radial-gradient(1200px 720px at 22% 6%, ${hsla(268, 50, 85, 0.60)} 0%, ${hsla(268, 50, 85, 0)} 64%),` +
      `radial-gradient(900px 620px at 84% 22%, ${hsla(228, 50, 86, 0.48)} 0%, ${hsla(228, 50, 86, 0)} 58%),` +
      `linear-gradient(180deg, ${hsla(255, 30, 96, 1)} 0%, ${hsla(245, 30, 94, 1)} 100%)`,
  },
  {
    id: 'paper-beige',
    keywords: [
      '读书', '阅读', '笔记', '写作', '手账', '整理', '复盘', '学习',
      '论文', '研究', '历史', '人文', '心理学', '语言', '英语',
      '计划', '总结', '思维导图', '方法论',
    ],
    background:
      `radial-gradient(1100px 680px at 18% 10%, ${hsla(46, 18, 93, 0.62)} 0%, ${hsla(46, 18, 93, 0)} 64%),` +
      `radial-gradient(920px 620px at 86% 20%, ${hsla(24, 14, 94, 0.50)} 0%, ${hsla(24, 14, 94, 0)} 58%),` +
      `linear-gradient(180deg, ${hsla(44, 12, 98, 1)} 0%, ${hsla(36, 10, 96, 1)} 100%)`,
  },
  {
    id: 'neon-trend',
    keywords: [
      '潮流', '街头', '霓虹', '赛博', '朋克', '电玩', '游戏', '二次元',
      '设计', 'ui', 'ux', '视觉', '摄影', '剪辑', 'vlog',
      '音乐节', '舞台', '演出',
    ],
    background:
      `radial-gradient(1200px 700px at 18% 10%, ${hsla(315, 60, 85, 0.62)} 0%, ${hsla(315, 60, 85, 0)} 62%),` +
      `radial-gradient(980px 640px at 86% 18%, ${hsla(190, 60, 85, 0.52)} 0%, ${hsla(190, 60, 85, 0)} 58%),` +
      `linear-gradient(180deg, ${hsla(230, 30, 96, 1)} 0%, ${hsla(220, 30, 94, 1)} 100%)`,
  },
]

const matchByKeywords = (signals: TextSignal[]) => {
  if (signals.length === 0) return null
  const rules = STYLE_RULES
  const scores = new Map<ProfileBackgroundThemeId, number>()
  for (const rule of rules) scores.set(rule.id, 0)

  for (const { text, weight } of signals) {
    for (const rule of rules) {
      for (const kw of rule.keywords) {
        const k = normalize(kw)
        if (!k) continue
        if (text.includes(k)) {
          scores.set(rule.id, (scores.get(rule.id) || 0) + weight)
        }
      }
    }
  }

  let best: StyleRule | null = null
  let bestScore = 0
  for (const rule of rules) {
    const s = scores.get(rule.id) || 0
    if (s > bestScore) {
      bestScore = s
      best = rule
    }
  }
  if (!best || bestScore <= 0) return null
  return { id: best.id, background: best.background } satisfies ProfileBackgroundTheme
}

const hashGeneratedBackground = (seed: string): ProfileBackgroundTheme => {
  const a = fnv1a32(seed)
  const b = fnv1a32(`${seed}::b`)
  const c = fnv1a32(`${seed}::c`)

  const baseHue = a % 360
  const h1 = baseHue
  const h2 = (baseHue + 30 + (b % 50)) % 360
  const h3 = (baseHue + 140 + (c % 70)) % 360

  const s1 = 10 + (a % 9)
  const s2 = 10 + (b % 10)
  const s3 = 10 + (c % 9)

  const l1 = 90 + (a % 4)
  const l2 = 90 + (b % 4)
  const l3 = 96 + (c % 3)

  const bg =
    `radial-gradient(1200px 700px at 18% 10%, ${hsla(h1, s1 + 8, l1, 0.62)} 0%, ${hsla(h1, s1 + 8, l1, 0)} 62%),` +
    `radial-gradient(980px 640px at 86% 18%, ${hsla(h2, s2 + 7, l2, 0.52)} 0%, ${hsla(h2, s2 + 7, l2, 0)} 58%),` +
    `linear-gradient(180deg, ${hsla(h3, s3, l3, 1)} 0%, ${hsla((h3 + 12) % 360, s3, clamp(l3 - 2, 92, 98), 1)} 100%)`

  return { id: 'hash-generated', background: bg }
}

export const defaultProfileBackgroundTheme: ProfileBackgroundTheme = {
  id: 'default',
  background: `linear-gradient(180deg, ${hsla(210, 10, 98, 1)} 0%, ${hsla(210, 8, 96, 1)} 100%)`,
}

export const mapUserProfileToBackgroundTheme = (
  userProfile?: UserProfile,
  options?: { seed?: string }
): ProfileBackgroundTheme => {
  const signals = buildSignals(userProfile)
  const matched = matchByKeywords(signals)
  if (matched) return matched

  const seed = stableSeedFromProfile(userProfile, options?.seed)
  if (!seed) return defaultProfileBackgroundTheme
  return hashGeneratedBackground(seed)
}

