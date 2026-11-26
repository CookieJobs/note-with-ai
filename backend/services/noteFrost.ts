/*
Input: 笔记创建时间、本轮消融锚点与已擦层数
Output: 当前冰层数投影与单次擦冰后的新状态
Pos: 笔记时光冰封的纯逻辑；不做模型写入，不触发富化或 revision 变化
Note: 阈值集中在此处维护；擦完最后一层即重置锚点开始新一轮计时
*/
export const FROST_MAX_LAYERS = 5;

const DAY_MS = 86_400_000;

// 距今多少天开始结出第 1..5 层冰。越久的记忆封得越厚。
export const FROST_LAYER_THRESHOLDS_DAYS = [2, 7, 21, 60, 180] as const;
const AFTER_THAW_THRESHOLDS_DAYS = [7, 14, 21, 60, 180] as const;

type TimeInput = Date | string | number | null | undefined;

function toTime(value: TimeInput): number | null {
  if (value === null || value === undefined || value === '') return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export type FrostInput = {
  createdAt: TimeInput;
  thawedAt?: TimeInput;
  melted?: number;
};

export function frostTargetLayers(ageMs: number, thresholds: readonly number[] = FROST_LAYER_THRESHOLDS_DAYS): number {
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 0;
  const days = ageMs / DAY_MS;
  let layers = 0;
  for (const threshold of thresholds) {
    if (days >= threshold) layers += 1;
  }
  return Math.min(layers, FROST_MAX_LAYERS);
}

function normalizedMelted(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

// 当前可见冰层 = 时间应结层数 - 本轮已擦层数。锚点优先取上一次擦净的时刻。
export function currentFrostLayers(input: FrostInput, now: number = Date.now()): number {
  const thawedAt = toTime(input.thawedAt);
  const start = thawedAt ?? toTime(input.createdAt);
  if (start === null) return 0;
  const target = frostTargetLayers(now - start, thawedAt === null ? FROST_LAYER_THRESHOLDS_DAYS : AFTER_THAW_THRESHOLDS_DAYS);
  return Math.max(0, target - normalizedMelted(input.melted));
}

export type FrostMeltResult = {
  thawedAt: Date | null;
  melted: number;
  layers: number;
  changed: boolean;
};

// 擦除一层。擦净最后一层时把锚点设为此刻并清空已擦数，卡片回到正常态重新计时。
export function meltOneFrostLayer(input: FrostInput, now: number = Date.now()): FrostMeltResult {
  const thawedTime = toTime(input.thawedAt);
  const thawedAt = thawedTime === null ? null : new Date(thawedTime);
  const melted = normalizedMelted(input.melted);
  const layers = currentFrostLayers(input, now);
  if (layers <= 0) return { thawedAt, melted, layers: 0, changed: false };

  const remaining = layers - 1;
  if (remaining <= 0) {
    return { thawedAt: new Date(now), melted: 0, layers: 0, changed: true };
  }
  return { thawedAt, melted: melted + 1, layers: remaining, changed: true };
}