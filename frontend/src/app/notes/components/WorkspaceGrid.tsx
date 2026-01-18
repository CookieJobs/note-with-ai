import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Note } from '../types';
import styles from '../notes.module.scss';
import { authFetch } from '../../../utils/auth';
import {
  WORKSPACE_ANIM_DELAY_MS,
  WORKSPACE_DELETE_TOTAL_MS,
  WORKSPACE_ENTER_MS,
  WORKSPACE_LAYOUT_BATCH_MS,
  WORKSPACE_MOVE_MS,
} from '../animationTimings';

type Props = {
  notes: Note[];
  selectedNoteId: string | null;
  hoveredNoteId?: string | null;
  onSelect: (id: string) => void;
  onHover?: (id: string | null) => void;
  onColorMapChange?: (map: Record<string, string>) => void;
};

type Cluster = {
  key: string;
  notes: Note[];
};

type PlacedItem = {
  note: Note;
  cluster: Cluster;
  idxInCluster: number;
  row: number; // 0-based
  col: number; // 0-based
  palette: { base: string; accent: string };
  displayColor: string;
};

function hashStringToInt(input: string) {
  // stable, fast (FNV-1a-ish)
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function hslToRgba(h: number, s: number, l: number, a: number) {
  // h: 0..360, s/l: 0..1
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hh < 60) [r1, g1, b1] = [c, x, 0];
  else if (hh < 120) [r1, g1, b1] = [x, c, 0];
  else if (hh < 180) [r1, g1, b1] = [0, c, x];
  else if (hh < 240) [r1, g1, b1] = [0, x, c];
  else if (hh < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function makeClusterColorFromAngle(params: {
  angleDeg: number; // 0..360
  radius01: number; // 0..1
  key: string;
  size: number;
}) {
  const { angleDeg, radius01, key, size } = params;
  const h0 = ((angleDeg % 360) + 360) % 360;

  // 关键：色相来自“连续方向空间”，并且严格满足：
  // - 同簇：色调一致（Hue 固定）
  // - 相邻簇：Hue 在圆环上连续变化（渐变趋势）
  // - 跨越中心（方向相反 +180°）：Hue 必然相反 +180°（不可能相似）
  // 因此这里**绝不**对 Hue 做任何基于 key 的抖动。
  const hue = (h0 + 200 + 360) % 360;

  // 为了保持整体“冷色玻璃”观感：越远离青蓝中心（≈200°）就越降低饱和度，而不是折叠色相
  const distToCool = (() => {
    const d = Math.abs(hue - 200);
    return Math.min(d, 360 - d) / 180; // 0..1
  })();
  const satScale = lerp(1.0, 0.72, distToCool);

  // 半径越外，稍微更暗（更有层次）；簇越大，稍微更亮（主块更显眼）
  const boost = clamp01(Math.log10(1 + size) / 2);
  const r = clamp01(radius01);
  // 微小稳定扰动：只作用于明度（不破坏 Hue 对称与同簇一致性），避免 RGB 量化导致的“完全相同”
  const micro = ((hashStringToInt(key) % 251) / 251 - 0.5) * 0.018; // 约 ±0.009
  // 同一色调下：随半径变化的明暗梯度拉大（离重心越近越亮、越远越暗）
  // 这样同簇内部“色差（明暗差）”更明显，但 Hue 仍保持一致。
  const lBase = lerp(0.50, 0.26, r) + 0.05 * boost + micro;
  const lAccent = lerp(0.78, 0.46, r) + 0.06 * boost + micro * 0.6;

  const satBase = 0.52 * satScale;
  const satAccent = 0.74 * satScale;

  const base = hslToRgba(hue, satBase, clamp01(lBase), 0.88);
  const accent = hslToRgba(hue, satAccent, clamp01(lAccent), 0.94);
  return { base, accent };
}

function parseRgba(input: string): { r: number; g: number; b: number; a: number } | null {
  const s = String(input || '').trim();
  const m = s.match(/rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/i);
  if (!m) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const a = Number(m[4]);
  if (![r, g, b, a].every((x) => Number.isFinite(x))) return null;
  return { r, g, b, a };
}

function rgbaToString(c: { r: number; g: number; b: number; a: number }) {
  const r = Math.max(0, Math.min(255, Math.round(c.r)));
  const g = Math.max(0, Math.min(255, Math.round(c.g)));
  const b = Math.max(0, Math.min(255, Math.round(c.b)));
  const a = Math.max(0, Math.min(1, c.a));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function wrapAngle01(t: number) {
  // 0..1
  const x = t % 1;
  return x < 0 ? x + 1 : x;
}

function inWedge01(theta01: number, start01: number, end01: number) {
  // wedge on circle [0,1)
  // handles wrap-around
  const t = wrapAngle01(theta01);
  const a = wrapAngle01(start01);
  const b = wrapAngle01(end01);
  if (a === b) return true;
  if (a < b) return t >= a && t < b;
  return t >= a || t < b;
}

function normalizeKeyword(s: string) {
  return String(s || '').trim().toLowerCase();
}

function getKeywords(note: Note) {
  const arr = Array.isArray(note.keywords) ? note.keywords : [];
  const uniq = new Set<string>();
  for (const k of arr) {
    const nk = normalizeKeyword(k);
    if (nk) uniq.add(nk);
  }
  return [...uniq];
}

function cosineSimilarityVec(a: ArrayLike<number>, b: ArrayLike<number>) {
  const n = a.length;
  if (!n || n !== b.length) return 0;
  let dot = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    const av = Number(a[i]);
    const bv = Number(b[i]);
    dot += av * bv;
    ma += av * av;
    mb += bv * bv;
  }
  if (ma <= 0 || mb <= 0) return 0;
  return dot / (Math.sqrt(ma) * Math.sqrt(mb));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (big.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function parseCssPx(v: string): number | null {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.endsWith('px')) {
    const n = Number.parseFloat(s.slice(0, -2));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function getGridMetrics(el: HTMLElement) {
  const cs = window.getComputedStyle(el);
  const cellW = parseCssPx(cs.getPropertyValue('--cell-w')) ?? 42;
  const gap = parseCssPx(cs.getPropertyValue('--cell-gap')) ?? 12;
  const width = el.getBoundingClientRect().width;
  // grid-template-columns: repeat(auto-fill, var(--cell-w)) + gap
  const cols = Math.max(1, Math.floor((width + gap) / (cellW + gap)));
  return { cols, cellW, gap, width };
}

export default function WorkspaceGrid({
  notes,
  selectedNoteId,
  hoveredNoteId = null,
  onSelect,
  onHover,
  onColorMapChange,
}: Props) {
  // 仅用于“工作区 hover 动画/挤压效果”：避免从历史列表 hover 触发网格 push
  const [gridHoverId, setGridHoverId] = useState<string | null>(null);
  // 工作区长方块 tooltip：三段式（延迟出现 -> 边缘 loading -> 展开）
  const [tipId, setTipId] = useState<string | null>(null);
  const [tipExpanded, setTipExpanded] = useState(false);
  const tipShowTimerRef = useRef<number | null>(null);
  const tipExpandTimerRef = useRef<number | null>(null);
  const tipPortalElRef = useRef<HTMLDivElement | null>(null);
  const workspaceScrollRef = useRef<HTMLDivElement | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number; place: 'top' | 'bottom' } | null>(null);
  const tipElRef = useRef<HTMLDivElement | null>(null);
  const [tipBox, setTipBox] = useState<{ w: number; h: number; perimeter: number } | null>(null);
  // hover 来源拆分：
  // - legendHoverKey：用户在图例上 hover 的簇（优先级最高）
  // - externalHoverKey：用户在长方块 / 历史笔记上 hover 的簇
  const [legendHoverKey, setLegendHoverKey] = useState<string | null>(null);
  const [externalHoverKey, setExternalHoverKey] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [topNavBottom, setTopNavBottom] = useState<number>(0);
  const [viewportW, setViewportW] = useState<number>(0);
  const [recommendations, setRecommendations] = useState<
    Array<{
      note: Pick<Note, '_id' | 'title' | 'content' | 'contentText' | 'summary' | 'updatedAt'>;
      score: number;
      s1: number;
      s2: number;
      type: string;
      reason: string;
    }>
  >([]);
  const recAbortRef = useRef<AbortController | null>(null);
  // 会话内缓存：同一页内重复选中同一笔记时，先秒出缓存，再后台刷新
  const recCacheRef = useRef<
    Map<
      string,
      {
        recs: typeof recommendations;
        sig: string;
        ts: number;
      }
    >
  >(new Map());
  const REC_CACHE_PREFIX = 'ws_recommend_cache_v1:'; // 跨刷新：sessionStorage key 前缀

  const readRecCache = (noteId: string) => {
    const mem = recCacheRef.current.get(noteId);
    if (mem) return mem;
    try {
      const raw = window.sessionStorage.getItem(`${REC_CACHE_PREFIX}${noteId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.recs) || typeof parsed.sig !== 'string') return null;
      const entry = { recs: parsed.recs, sig: parsed.sig, ts: Number(parsed.ts) || 0 };
      recCacheRef.current.set(noteId, entry);
      return entry;
    } catch {
      return null;
    }
  };

  const writeRecCache = (noteId: string, entry: { recs: typeof recommendations; sig: string; ts: number }) => {
    recCacheRef.current.set(noteId, entry);
    try {
      window.sessionStorage.setItem(`${REC_CACHE_PREFIX}${noteId}`, JSON.stringify(entry));
    } catch {
      // ignore quota/serialization errors
    }
  };
  const legendCloseTimerRef = useRef<number | null>(null);
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const rafRef = useRef<number | null>(null);
  const gridElRef = useRef<HTMLDivElement | null>(null);
  const [gridCols, setGridCols] = useState<number>(16);
  // 布局列数：首次稳定测量后冻结，避免任何后续 reflow/ResizeObserver 触发重排
  const layoutColsRef = useRef<number | null>(null);
  // 固定容器坐标：页面加载时计算一次，之后固定不变
  const [fixedContainer, setFixedContainer] = useState<{ 
    left: number; 
    top: number; 
    width: number; 
    height: number;
  } | null>(null);
  const fixedContainerRef = useRef<typeof fixedContainer>(null);
  const [frozenLayout, setFrozenLayout] = useState<null | { clusters: Cluster[]; placed: PlacedItem[] }>(null);
  const releaseFrozenTimerRef = useRef<number | null>(null);
  // 合并提交：computedLayout 变化后，延迟一小段时间再一次性 commit，避免“新增笔记 + 新增关键词”触发两次整体移动
  const [committedLayout, setCommittedLayout] = useState<null | { clusters: Cluster[]; placed: PlacedItem[] }>(null);
  const commitTimerRef = useRef<number | null>(null);
  const committedLayoutRef = useRef<null | { clusters: Cluster[]; placed: PlacedItem[] }>(null);
  const pendingLayoutRef = useRef<null | { clusters: Cluster[]; placed: PlacedItem[] }>(null);
  const txnNewIdsRef = useRef<Set<string>>(new Set());
  const txnSettleTimerRef = useRef<number | null>(null);
  // 避免“首次加载/刷新”把后端拉取的初始 notes 当成“新增笔记”来做挤出动画：
  // 页面稳定一小段时间后才允许触发新增动画。
  const allowNewNoteAnimRef = useRef(false);
  // 稳定性：簇顺序/扇区宽度在“簇集合变化”前保持不变，避免 keyword 小变动导致全局扇区漂移
  const stableClusterOrderRef = useRef<string[] | null>(null);
  const stableWedgeFracRef = useRef<Map<string, number> | null>(null);
  // 新增笔记动画：先让旧方块移动到“包含新笔记”的新布局，然后再把新方块在目标位置“挤出来”
  const [heldNewIds, setHeldNewIds] = useState<string[]>([]);
  const [enteringNewIds, setEnteringNewIds] = useState<string[]>([]);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const newNoteAnimTimersRef = useRef<{ show?: number; clear?: number }>({});
  const deleteAnimTimerRef = useRef<number | null>(null);
  const heldNewIdsRef = useRef<Set<string>>(new Set());

  // 首次加载：延迟开启"新增笔记挤出动画"
  useEffect(() => {
    const t = window.setTimeout(() => {
      allowNewNoteAnimRef.current = true;
    }, 1200);
    return () => window.clearTimeout(t);
  }, []);

  // 首次加载：计算容器的固定坐标（left, top, width, height）
  // 这些坐标相对于视口，之后永远不变
  useEffect(() => {
    if (fixedContainerRef.current !== null) return; // 只计算一次

    let cancelled = false;
    let raf = 0;
    let stableCount = 0;
    let frames = 0;
    let last: { left: number; top: number; width: number; height: number } | null = null;

    const EPS = 0.5; // px
    const NEED_STABLE_FRAMES = 6;
    const MAX_FRAMES = 180; // ~3s @60fps

    const tick = () => {
      if (cancelled || fixedContainerRef.current !== null) return;
      frames++;

      const historyPane = document.querySelector('[aria-label="历史笔记列表"]') as HTMLElement | null;
      const scrollEl = workspaceScrollRef.current;
      if (!historyPane || !scrollEl) {
        raf = window.requestAnimationFrame(tick);
        return;
      }

      const historyRect = historyPane.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const viewportCenter = window.innerWidth / 2;

      // 你的逻辑：基于“历史栏右边界 + gap”确定 left（固定），然后用视口中心反推 width（保证中心在视口中心）
      const GAP = 18; // 对应 splitLayout 的 gap: 18px
      const left = historyRect.right + GAP;
      const width = Math.max(320, (viewportCenter - left) * 2);

      const top = scrollRect.top;
      const height = scrollRect.height;

      const cur = { left, top, width, height };

      if (
        last &&
        Math.abs(cur.left - last.left) < EPS &&
        Math.abs(cur.top - last.top) < EPS &&
        Math.abs(cur.width - last.width) < EPS &&
        Math.abs(cur.height - last.height) < EPS
      ) {
        stableCount++;
      } else {
        stableCount = 0;
      }
      last = cur;

      if (stableCount >= NEED_STABLE_FRAMES || frames >= MAX_FRAMES) {
        fixedContainerRef.current = cur;
        setFixedContainer(cur);
        return;
      }

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, []);

  // 将簇长方块容器的固定坐标写到全局 CSS 变量，供工作台/浮层复用
  useEffect(() => {
    if (!fixedContainer) return;
    const root = document.documentElement;
    root.style.setProperty('--ws-grid-left', `${fixedContainer.left}px`);
    root.style.setProperty('--ws-grid-top', `${fixedContainer.top}px`);
    root.style.setProperty('--ws-grid-width', `${fixedContainer.width}px`);
    root.style.setProperty('--ws-grid-height', `${fixedContainer.height}px`);
  }, [fixedContainer]);

  // tooltip portal root（渲染到 body：避免被 workspaceScroll 的 overflow 裁切）
  useEffect(() => {
    const el = document.createElement('div');
    el.setAttribute('data-ws-tooltip-root', 'true');
    document.body.appendChild(el);
    tipPortalElRef.current = el;
    return () => {
      try {
        document.body.removeChild(el);
      } catch {
        // ignore
      }
      tipPortalElRef.current = null;
    };
  }, []);

  // 读顶栏 bottom：图例是 fixed，需要确保不会被 TopNavigation(sticky, z-index:1000) 盖住
  useLayoutEffect(() => {
    const update = () => {
      const header = document.querySelector('header');
      if (!header) return;
      const r = header.getBoundingClientRect();
      setTopNavBottom(r.bottom);
      setViewportW(window.innerWidth);
    };
    update();
    // 下一帧再读一次，避免首帧布局未稳定导致的偏差
    const raf = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
    };
  }, []);

  // 选中打开详情浮层时，关闭 tooltip（避免浮层出现后仍残留）
  useEffect(() => {
    if (!selectedNoteId) return;
    setTipId(null);
    setTipExpanded(false);
    setTipPos(null);
    setTipBox(null);
    if (tipShowTimerRef.current) window.clearTimeout(tipShowTimerRef.current);
    tipShowTimerRef.current = null;
    if (tipExpandTimerRef.current) window.clearTimeout(tipExpandTimerRef.current);
    tipExpandTimerRef.current = null;
  }, [selectedNoteId]);

  // 只在“初始 tooltip（未展开）”阶段测量真实盒子，确保描边严格贴合
  useLayoutEffect(() => {
    if (!tipId) return;
    if (tipExpanded) return;
    if (!tipPos) return;
    const el = tipElRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      // 圆角跟 CSS 同步：14px；描边 rect 会 inset 1.5px 且宽高减 3px，所以周长也按内框算
      const rad0 = 14;
      const innerW = Math.max(1, w - 3);
      const innerH = Math.max(1, h - 3);
      const rad = Math.min(rad0, innerW / 2, innerH / 2);
      const perim = 2 * (innerW + innerH - 4 * rad) + 2 * Math.PI * rad;
      setTipBox({ w, h, perimeter: Math.max(10, perim) });
    });
    return () => cancelAnimationFrame(raf);
  }, [tipId, tipExpanded, tipPos]);

  // tooltip 展开后：如果会超出“长方块区域”，则横向修正位置
  useLayoutEffect(() => {
    if (!tipId) return;
    if (!tipExpanded) return;
    if (!tipPos) return;
    const el = tipElRef.current;
    if (!el) return;
    const boundsEl = workspaceScrollRef.current || gridElRef.current;
    if (!boundsEl) return;
    const tipRect = el.getBoundingClientRect();
    const bounds = boundsEl.getBoundingClientRect();
    const pad = 8;
    const halfW = tipRect.width / 2;
    const minX = bounds.left + pad + halfW;
    const maxX = bounds.right - pad - halfW;
    if (minX > maxX) return;
    const nextX = Math.min(maxX, Math.max(minX, tipPos.x));
    if (Math.abs(nextX - tipPos.x) > 0.5) {
      setTipPos({ ...tipPos, x: nextX });
    }
  }, [tipId, tipExpanded, tipPos]);

  // 组件卸载：清理 tooltip 定时器
  useEffect(() => {
    return () => {
      if (tipShowTimerRef.current) window.clearTimeout(tipShowTimerRef.current);
      if (tipExpandTimerRef.current) window.clearTimeout(tipExpandTimerRef.current);
      tipShowTimerRef.current = null;
      tipExpandTimerRef.current = null;
    };
  }, []);

  // 交互规则：
  // - 只有 hover 图例时，才做“整簇高亮/其它簇变暗”
  // - hover 方块/历史笔记：只高亮单个方块，不做整簇高亮
  const legendClusterKey = legendHoverKey;
  // 仅用于显示标签（不触发整簇高亮）
  const hoverLabelKey = legendHoverKey ?? externalHoverKey;
  // hover 方块/历史笔记：只聚焦单个方块（其它方块变暗），不做整簇高亮
  // 但要加一点“清空延迟”，避免从一个方块移动到另一个时 hoveredNoteId 瞬间变 null 导致闪烁。
  const [singleFocusId, setSingleFocusId] = useState<string | null>(null);
  const singleFocusClearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // 图例 hover 优先：此时聚焦逻辑由 legendClusterKey 接管
    if (legendClusterKey) {
      if (singleFocusClearTimerRef.current) {
        window.clearTimeout(singleFocusClearTimerRef.current);
        singleFocusClearTimerRef.current = null;
      }
      setSingleFocusId(null);
      return;
    }

    if (hoveredNoteId) {
      if (singleFocusClearTimerRef.current) {
        window.clearTimeout(singleFocusClearTimerRef.current);
        singleFocusClearTimerRef.current = null;
      }
      setSingleFocusId(hoveredNoteId);
      return;
    }

    // 延迟清空：避免 hover 切换间隙产生“全局变暗闪烁”
    if (singleFocusClearTimerRef.current) {
      window.clearTimeout(singleFocusClearTimerRef.current);
    }
    singleFocusClearTimerRef.current = window.setTimeout(() => {
      setSingleFocusId(null);
      singleFocusClearTimerRef.current = null;
    }, 180);

    return () => {
      if (singleFocusClearTimerRef.current) {
        window.clearTimeout(singleFocusClearTimerRef.current);
        singleFocusClearTimerRef.current = null;
      }
    };
  }, [hoveredNoteId, legendClusterKey]);

  // tooltip 定位：hover 时跟随 cell；滚动/resize 时重新计算
  useEffect(() => {
    if (!tipId) return;

    const compute = () => {
      const el = cellRefs.current.get(tipId);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = 10;
      const x0 = r.left + r.width / 2;
      const place: 'top' | 'bottom' = r.top < 90 ? 'bottom' : 'top';
      const y0 = place === 'top' ? r.top : r.bottom;
      const x = Math.max(pad, Math.min(vw - pad, x0));
      const y = Math.max(pad, Math.min(vh - pad, y0));
      setTipPos({ x, y, place });
    };

    compute();

    const scroller = workspaceScrollRef.current;
    const onScroll = () => compute();
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (scroller) scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [tipId]);

  const keywordCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) {
      for (const k of getKeywords(n)) {
        m.set(k, (m.get(k) || 0) + 1);
      }
    }
    return m;
  }, [notes]);

  const getPrimaryClusterKey = (note: Note) => {
    const kws = getKeywords(note);
    if (kws.length === 0) return '未分类';
    kws.sort((a, b) => {
      const ca = keywordCounts.get(a) || 0;
      const cb = keywordCounts.get(b) || 0;
      if (cb !== ca) return cb - ca; // 频次高的优先（更容易形成“连续色块”）
      return a.localeCompare(b); // 稳定兜底
    });
    return kws[0];
  };

  const rawClusters = useMemo<Cluster[]>(() => {
    const KEYWORD_W = 0.8;
    const EMBEDDING_W = 0.2;

    const map = new Map<string, Note[]>();
    for (const n of notes) {
      const k = getPrimaryClusterKey(n);
      const arr = map.get(k) || [];
      arr.push(n);
      map.set(k, arr);
    }

    // 先构造簇描述信息：keyword union + embedding centroid
    type ClusterDesc = {
      key: string;
      notes: Note[];
      size: number;
      kwSet: Set<string>;
      centroid: Float64Array | null; // 未覆盖时为 null
    };

    const descs: ClusterDesc[] = [];
    for (const [key, arr] of map.entries()) {
      // 同簇内：只按 createdAt（稳定）新到旧。
      // 注意：不要用 updatedAt，否则“保存内容”会导致簇内顺序变化 -> 网格整体抖动/重排，观感很差。
      const sorted = [...arr].sort((a, b) => {
        const ta = Date.parse(a.createdAt || '');
        const tb = Date.parse(b.createdAt || '');
        const da = isNaN(ta) ? 0 : ta;
        const db = isNaN(tb) ? 0 : tb;
        if (db !== da) return db - da;
        return a._id.localeCompare(b._id); // 最终稳定兜底
      });

      const kwSet = new Set<string>();
      for (const n of sorted) for (const k of getKeywords(n)) kwSet.add(k);

      // embedding centroid（仅用有向量的笔记）
      let sum: Float64Array | null = null;
      let cnt = 0;
      for (const n of sorted) {
        const emb = (n as any).embedding as number[] | undefined;
        if (!Array.isArray(emb) || emb.length === 0) continue;
        if (!sum) sum = new Float64Array(emb.length);
        if (sum.length !== emb.length) continue; // 维度不一致直接跳过
        for (let i = 0; i < emb.length; i++) sum[i] += emb[i];
        cnt++;
      }
      const centroid = sum && cnt > 0 ? new Float64Array(sum.map((v) => v / cnt)) : null;

      descs.push({ key, notes: sorted, size: sorted.length, kwSet, centroid });
    }

    // 1) 先用“混合相似度”给簇排一个 1D 顺序：相近簇在顺序上相邻
    //    这个顺序同时用于：颜色渐变 & 布局装箱的处理顺序（相近簇更可能挨在一起）
    const bySize = [...descs].sort((a, b) => b.size - a.size);
    const start = bySize[0] || descs[0];
    const unplaced = new Map<string, ClusterDesc>();
    for (const d of descs) unplaced.set(d.key, d);

    const order: ClusterDesc[] = [];
    if (start) {
      order.push(start);
      unplaced.delete(start.key);
    }

    const sim = (a: ClusterDesc, b: ClusterDesc) => {
      const kwSim = jaccardSimilarity(a.kwSet, b.kwSet);
      const embSim =
        a.centroid && b.centroid && a.centroid.length === b.centroid.length
          ? cosineSimilarityVec(a.centroid, b.centroid)
          : 0;
      // cosine -1..1 -> 0..1
      const emb01 = (embSim + 1) / 2;
      return KEYWORD_W * kwSim + EMBEDDING_W * emb01;
    };

    while (unplaced.size > 0) {
      const cur = order[order.length - 1];
      let best: ClusterDesc | null = null;
      let bestScore = -1;
      for (const d of unplaced.values()) {
        const s = cur ? sim(cur, d) : 0;
        if (s > bestScore) {
          bestScore = s;
          best = d;
        }
      }
      // 如果完全无相似度，就按 size 大的优先填（避免小簇把布局分裂得太碎）
      if (!best || bestScore <= 0.0001) {
        const fallback = [...unplaced.values()].sort((a, b) => b.size - a.size || a.key.localeCompare(b.key))[0];
        best = fallback;
      }
      order.push(best);
      unplaced.delete(best.key);
    }

    // 2) 识别“离群簇”：与其它簇的最大相似度很低 -> 给一点点暖色（更像示例图里的局部热区）
    const maxAffinity = new Map<string, number>();
    for (const a of descs) {
      let mx = 0;
      for (const b of descs) {
        if (a === b) continue;
        mx = Math.max(mx, sim(a, b));
      }
      maxAffinity.set(a.key, mx);
    }
    const affinitiesSorted = [...maxAffinity.entries()].sort((a, b) => (a[1] - b[1]));
    const warmCount = Math.min(3, Math.max(0, Math.round(descs.length * 0.12)));
    const warmKeys = new Set(affinitiesSorted.slice(0, warmCount).map(([k]) => k));

    // 3) 按顺序映射连续色相：冷色区为主，暖色只给离群簇
    const coldHueStart = 188; // cyan
    const coldHueEnd = 222; // blue
    const warmHueStart = 332; // magenta
    const warmHueEnd = 26; // orange (wrap)

    // 返回“按混合相似度排序”的簇（颜色与布局绑定，放到 placed 阶段再算）
    return order.map((d) => ({ key: d.key, notes: d.notes }));
  }, [notes, keywordCounts]);

  // 稳定簇顺序：避免 embedding/频次细微变化导致簇顺序波动 -> 全局扇区重排
  const computedClusters = useMemo<Cluster[]>(() => {
    const next = rawClusters;
    const nextKeys = next.map((c) => c.key);
    const nextKeySetSig = [...nextKeys].sort().join('|');

    const prevOrder = stableClusterOrderRef.current;
    const prevKeySetSig = prevOrder ? [...prevOrder].sort().join('|') : null;

    // 只有当“簇集合变化”时，才更新顺序与扇区宽度基准
    if (!prevOrder || prevKeySetSig !== nextKeySetSig) {
      stableClusterOrderRef.current = nextKeys;

      // 同步更新“扇区宽度基准”：用当下簇 size 做一次归一化快照
      const sum = next.reduce((s, c) => s + c.notes.length, 0) || 1;
      const m = new Map<string, number>();
      for (const c of next) m.set(c.key, c.notes.length / sum);
      stableWedgeFracRef.current = m;
      return next;
    }

    // 集合不变：按 prevOrder 排序（稳定）
    const byKey = new Map(next.map((c) => [c.key, c] as const));
    const out: Cluster[] = [];
    for (const k of prevOrder) {
      const c = byKey.get(k);
      if (c) out.push(c);
    }
    // 理论上不会发生，但做个兜底（不改变已有顺序）
    for (const c of next) if (!out.includes(c)) out.push(c);
    return out;
  }, [rawClusters]);

  const isWorkspaceOverlayOpen = Boolean(selectedNoteId);
  const shouldShowRecommendDock = isWorkspaceOverlayOpen && recommendations.length > 0;

  // 语义联想（方案B）：选中工作台笔记时拉取联想结果
  useEffect(() => {
    if (!selectedNoteId) {
      setRecommendations([]);
      return;
    }

    // 先同步展示本地缓存（SWR：stale-while-revalidate）
    const cached = readRecCache(selectedNoteId);
    if (cached?.recs && Array.isArray(cached.recs)) {
      setRecommendations(cached.recs);
    } else {
      // 没缓存时，先清空（避免展示上一次笔记的联想）
      setRecommendations([]);
    }

    // 取消上一次请求
    if (recAbortRef.current) recAbortRef.current.abort();
    const ac = new AbortController();
    recAbortRef.current = ac;

    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await authFetch('/api/recommend/semantic-notes', {
            method: 'POST',
            signal: ac.signal,
            body: JSON.stringify({
              noteId: selectedNoteId,
              recallK: 30,
              finalK: 10,
              s1Threshold: 0.35,
              hardThreshold: 0.62,
            }),
          });
          const json = await res.json();
          const recs = json?.data?.recommendations;
          if (Array.isArray(recs)) {
            // 只有结果发生变化才更新 UI（避免无意义重渲染/闪动）
            const makeSig = (arr: any[]) =>
              arr
                .map((x) => {
                  const id = String(x?.note?._id || '');
                  const s = Number.isFinite(Number(x?.score)) ? Number(x.score).toFixed(3) : '';
                  const r = String(x?.reason || '').trim();
                  return `${id}:${s}:${r}`;
                })
                .join('|');
            const nextSig = makeSig(recs);
            const prev = readRecCache(selectedNoteId);
            if (!prev || prev.sig !== nextSig) {
              setRecommendations(recs);
              writeRecCache(selectedNoteId, { recs, sig: nextSig, ts: Date.now() });
            }
          } else {
            setRecommendations([]);
          }
        } catch (e: any) {
          if (e?.name === 'AbortError') return;
          console.warn('联想笔记请求失败（已忽略）:', e?.message || e);
          setRecommendations([]);
        }
      })();
    }, 220);

    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [selectedNoteId]);

  // 冻结网格列数：仅在“固定容器坐标”就绪后测量一次，然后永远不再变化
  useLayoutEffect(() => {
    if (!fixedContainer) return;
    const el = gridElRef.current;
    if (!el) return;
    if (layoutColsRef.current != null) return;
    const { cols } = getGridMetrics(el);
    layoutColsRef.current = cols;
    setGridCols(cols);
  }, [fixedContainer]);

  const computedPlaced = useMemo<PlacedItem[]>(() => {
    // 避免极端大数据把 DOM 撑爆
    const MAX = 1200;
    const actualCols = Math.max(1, gridCols || 1);

    // 关键：用“首次稳定测量”的列数来计算扇形与布局（冻结），避免后续任何布局波动
    const cols = layoutColsRef.current ?? actualCols;

    const clusterItems: Array<{ cluster: Cluster; items: Array<{ note: Note; idxInCluster: number }> }> = [];
    let total = 0;
    for (const c of computedClusters) {
      if (total >= MAX) break;
      const arr: Array<{ note: Note; idxInCluster: number }> = [];
      for (let i = 0; i < c.notes.length; i++) {
        arr.push({ note: c.notes[i], idxInCluster: i });
        total++;
        if (total >= MAX) break;
      }
      if (arr.length) clusterItems.push({ cluster: c, items: arr });
    }

    const N = clusterItems.reduce((sum, x) => sum + x.items.length, 0);
    if (N === 0) return [];

    // A 定义：一个全局中心点（重心）作为"簇分界点"，每个簇在自己的扇形里从中心向外扩展
    // 为了让"扇形"更明显：按半径从小到大逐层填充，且每个格子只能分配给其角度所在扇区的簇
    // 注意：这里的 cols 是固定的 VIRTUAL_COLS，不是实际容器列数

    const totalCells = N;
    const rows = Math.max(1, Math.ceil(totalCells / cols) + 24); // 给上下扇形扩展留足空间
    const centerR = (rows - 1) / 2;
    const centerC = (cols - 1) / 2;

    // 每簇的目标配额（格子数）
    const quotas = clusterItems.map(({ cluster, items }) => ({
      key: cluster.key,
      cluster,
      items,
      remaining: items.length,
    }));

    // 角度扇区分配：
    // - 顺序：稳定（computedClusters 已做“仅簇集合变化才更新顺序”）
    // - 宽度：默认使用 stableWedgeFracRef（仅簇集合变化才更新），避免成员在簇间移动导致全局扇区漂移
    const wedges = (() => {
      const fracMap = stableWedgeFracRef.current;
      const sumFrac =
        quotas.reduce((s, q) => s + (fracMap?.get(q.key) ?? 0), 0) ||
        quotas.reduce((s, q) => s + q.items.length, 0) ||
        1;
      let acc = 0;
      return quotas.map((q) => {
        const baseFrac = fracMap?.get(q.key);
        const frac = (baseFrac != null ? baseFrac : q.items.length / (quotas.reduce((s, x) => s + x.items.length, 0) || 1)) / sumFrac;
        const start = acc;
        const end = acc + frac;
        acc = end;
        const mid = (start + end) / 2;
        return { key: q.key, start01: start, end01: end, mid01: wrapAngle01(mid) };
      });
    })();

    const wedgeByKey = new Map(wedges.map((w) => [w.key, w]));
    const quotaByKey = new Map(quotas.map((q) => [q.key, q]));

    // 生成所有候选格子（按半径从中心向外）
    const positions: Array<{ r: number; c: number; d: number; theta01: number }> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dy = r - centerR;
        const dx = c - centerC;
        const d = dy * dy + dx * dx;
        const ang = Math.atan2(dy, dx); // -pi..pi
        const theta01 = wrapAngle01((ang + Math.PI) / (2 * Math.PI)); // 0..1
        positions.push({ r, c, d, theta01 });
      }
    }
    positions.sort((a, b) => a.d - b.d);

    // 分配（严格扇区）：每个格子只分配给其角度所在的扇区；
    // 该扇区配额用完就留空，绝不把格子“借位”给其它扇区（避免低相关簇被挪到别的方向）。
    const out: PlacedItem[] = [];
    const maxRadius = Math.max(1, Math.sqrt(positions[positions.length - 1]?.d || 1));

    // 先按扇区把候选格子分桶（桶内按半径从近到远）
    const buckets = new Map<string, Array<{ r: number; c: number; d: number; theta01: number }>>();
    for (const w of wedges) buckets.set(w.key, []);
    for (const p of positions) {
      for (const w of wedges) {
        if (inWedge01(p.theta01, w.start01, w.end01)) {
          buckets.get(w.key)!.push(p);
          break;
        }
      }
    }
    for (const [k, arr] of buckets.entries()) {
      arr.sort((a, b) => a.d - b.d);
      buckets.set(k, arr);
    }

    // 再严格填充每个扇区（不借位）
    for (const q of quotas) {
      const w = wedgeByKey.get(q.key);
      const bucket = buckets.get(q.key) || [];
      const angleDeg = ((w?.mid01 ?? 0) * 360) % 360;

      for (let i = 0; i < bucket.length && q.remaining > 0; i++) {
        const p = bucket[i];
        const idx = q.items.length - q.remaining;
        const it = q.items[idx];
        q.remaining--;

        const radius01 = clamp01(Math.sqrt(p.d) / maxRadius);
        const palette = makeClusterColorFromAngle({ angleDeg, radius01, key: q.key, size: q.items.length });

        out.push({
          note: it.note,
          cluster: q.cluster,
          idxInCluster: it.idxInCluster,
          row: p.r,
          col: p.c,
          palette,
          displayColor: palette.base, // 先占位，下面 shift 后会按 (row,col) 重新计算
        });
      }
    }

    // 视觉对齐：
    // - 旧逻辑是"贴边到 (0,0)"，会让整体形状粘在左上，造成"左/上不够辐射"的观感
    // - 新逻辑：水平方向在 actualCols（实际容器列数）内尽量居中；垂直方向给一个很小的顶部留白
    // - 关键：扇形和颜色已经在虚拟坐标系中计算完成（与容器无关），这里只做平移
    let minRow = Infinity;
    let minCol = Infinity;
    let maxRow = -Infinity;
    let maxCol = -Infinity;
    for (const p of out) {
      minRow = Math.min(minRow, p.row);
      minCol = Math.min(minCol, p.col);
      maxRow = Math.max(maxRow, p.row);
      maxCol = Math.max(maxCol, p.col);
    }
    if (isFinite(minRow) && isFinite(minCol) && isFinite(maxRow) && isFinite(maxCol)) {
      const shapeW = Math.max(1, maxCol - minCol + 1);
      const shapeH = Math.max(1, maxRow - minRow + 1);
      const padTop = 2;
      // 使用实际容器列数 actualCols 来计算居中偏移
      const padLeft = Math.max(0, Math.floor((actualCols - shapeW) / 2));
      const dRow = padTop - minRow;
      const dCol = padLeft - minCol;

      for (const p of out) {
        p.row += dRow;
        p.col += dCol;
      }

      if (process.env.NODE_ENV !== 'production') {
        // 轻量调试：验证"以中心辐射"的象限分布是否明显偏置
        const cR = centerR + dRow;
        const cC = centerC + dCol;
        let q1 = 0, q2 = 0, q3 = 0, q4 = 0;
        for (const p of out) {
          const up = p.row < cR;
          const left = p.col < cC;
          if (up && left) q1++;
          else if (up && !left) q2++;
          else if (!up && left) q3++;
          else q4++;
        }
        // eslint-disable-next-line no-console
        console.log('[WorkspaceGrid layout]', {
          virtualCols: cols,
          actualCols,
          N,
          center: { r: Number(cR.toFixed(2)), c: Number(cC.toFixed(2)) },
          bounds: { minRow: minRow + dRow, maxRow: maxRow + dRow, minCol: minCol + dCol, maxCol: maxCol + dCol, shapeW, shapeH },
          quadrants: { q1_upLeft: q1, q2_upRight: q2, q3_downLeft: q3, q4_downRight: q4 },
        });
      }
    }

    // 真实显示色：必须随位置变化（base/accent 选择绑定到 (row,col)）
    for (const p of out) {
      const useAccent = ((p.row * 31 + p.col * 17) % 7) === 0;
      p.displayColor = useAccent ? p.palette.accent : p.palette.base;
    }

    // 渲染顺序：按 (row,col) 排，保证键盘/阅读顺序与视觉一致
    out.sort((a, b) => (a.row - b.row) || (a.col - b.col));
    return out;
  }, [computedClusters, gridCols]);

  // 当前用于渲染的布局（优先级：浮层冻结 > 合并提交后的 committed > 实时 computed）
  const activeLayout = frozenLayout ?? committedLayout ?? { clusters: computedClusters, placed: computedPlaced };
  const clusters = activeLayout.clusters;

  const noteIdToClusterKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clusters) {
      for (const n of c.notes) m.set(n._id, c.key);
    }
    return m;
  }, [clusters]);

  // 工作台展开时：冻结“重排结果”，直到关闭后才一次性应用最新布局（这样能看见关闭瞬间的移动动画）
  useEffect(() => {
    // 任何状态切换都先清理上一次的释放计时器
    if (releaseFrozenTimerRef.current) {
      window.clearTimeout(releaseFrozenTimerRef.current);
      releaseFrozenTimerRef.current = null;
    }

    if (isWorkspaceOverlayOpen) {
      // freeze only once per open
      setFrozenLayout((cur) => (cur ? cur : { clusters: computedClusters, placed: computedPlaced }));
      return;
    }

    // 关闭：延时释放冻结（释放后才会应用最新 computedPlaced，并触发 FLIP 动画）
    if (frozenLayout) {
      releaseFrozenTimerRef.current = window.setTimeout(() => {
        setFrozenLayout(null);
        releaseFrozenTimerRef.current = null;
      }, WORKSPACE_ANIM_DELAY_MS);
    }

    return () => {
      if (releaseFrozenTimerRef.current) {
        window.clearTimeout(releaseFrozenTimerRef.current);
        releaseFrozenTimerRef.current = null;
      }
    };
  }, [isWorkspaceOverlayOpen, computedClusters, computedPlaced, frozenLayout]);

  const placed = activeLayout.placed;

  const heldNewIdSet = useMemo(() => new Set(heldNewIds), [heldNewIds]);
  const enteringNewIdSet = useMemo(() => new Set(enteringNewIds), [enteringNewIds]);
  const deletingIdSet = useMemo(() => new Set(deletingIds), [deletingIds]);

  // 可见布局：当有“新增笔记”动画时，先隐藏新笔记（其它方块会先移动，留下空位）
  const visiblePlaced = useMemo(() => {
    let out = placed;
    if (heldNewIds.length) out = out.filter((p) => !heldNewIdSet.has(p.note._id));
    // 删除动画期间：仍然渲染被删方块（用旧布局），但标记为 deleting 并禁用交互；真正移除要等碎裂结束后
    return out;
  }, [placed, heldNewIds.length, heldNewIdSet]);

  // 输出颜色映射：用于左侧历史列表的选中色晕染
  useEffect(() => {
    if (!onColorMapChange) return;
    const map: Record<string, string> = {};
    for (const p of visiblePlaced) {
      map[p.note._id] = p.displayColor;
    }
    onColorMapChange(map);
  }, [visiblePlaced, onColorMapChange]);

  // 合并提交（batch commit）：
  // - 将“新增笔记 + 关键词变更 + embedding 回填”等紧挨着的更新合并为一次布局切换
  // - 若检测到新增 noteId，则先隐藏新方块，让旧方块先移动到最终位置，再把新方块“挤出来”
  useEffect(() => {
    if (isWorkspaceOverlayOpen) return;
    if (frozenLayout) return;

    // 记录“最新计算布局”
    pendingLayoutRef.current = { clusters: computedClusters, placed: computedPlaced };

    // 首次：直接 commit（不做新增动画/事务）
    if (!committedLayoutRef.current) {
      committedLayoutRef.current = pendingLayoutRef.current;
      setCommittedLayout(pendingLayoutRef.current);
      return;
    }

    const prevIds = new Set((committedLayoutRef.current?.placed ?? []).map((p) => p.note._id));
    const nextIds = new Set(computedPlaced.map((p) => p.note._id));
    const added: string[] = [];
    for (const id of nextIds) if (!prevIds.has(id)) added.push(id);
    const removed: string[] = [];
    for (const id of prevIds) if (!nextIds.has(id)) removed.push(id);

    // 删除事务（优先级最高）：先播放“变灰 -> 碎裂”动画，结束后才提交最终布局并触发其它方块移动
    // 首次加载阶段不做删除动画（避免刷新时 notes 未齐导致误判）
    if (removed.length && allowNewNoteAnimRef.current) {
      // 清掉新增相关动画，避免叠加
      if (newNoteAnimTimersRef.current.show) window.clearTimeout(newNoteAnimTimersRef.current.show);
      if (newNoteAnimTimersRef.current.clear) window.clearTimeout(newNoteAnimTimersRef.current.clear);
      setHeldNewIds([]);
      heldNewIdsRef.current = new Set();
      setEnteringNewIds([]);

      // 进入删除态：保持旧布局不变（其它方块不动）
      setDeletingIds(removed);
      committedLayoutRef.current = committedLayoutRef.current; // 显式：保持原布局
      setCommittedLayout(committedLayoutRef.current);

      // 期间不要做其它 commit
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      if (txnSettleTimerRef.current) {
        window.clearTimeout(txnSettleTimerRef.current);
        txnSettleTimerRef.current = null;
      }
      if (deleteAnimTimerRef.current) window.clearTimeout(deleteAnimTimerRef.current);

      deleteAnimTimerRef.current = window.setTimeout(() => {
        const pending = pendingLayoutRef.current;
        if (pending) {
          committedLayoutRef.current = pending;
          setCommittedLayout(pending);
        }
        setDeletingIds([]);
        deleteAnimTimerRef.current = null;
      }, WORKSPACE_DELETE_TOTAL_MS);

      return () => {
        if (deleteAnimTimerRef.current) {
          window.clearTimeout(deleteAnimTimerRef.current);
          deleteAnimTimerRef.current = null;
        }
      };
    }

    // 进入“新增事务”：只要检测到新增 noteId，就冻结提交，等变化稳定后一次性提交最终布局
    if ((added.length || txnNewIdsRef.current.size > 0) && allowNewNoteAnimRef.current) {
      for (const id of added) txnNewIdsRef.current.add(id);

      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      if (txnSettleTimerRef.current) {
        window.clearTimeout(txnSettleTimerRef.current);
        txnSettleTimerRef.current = null;
      }

      // “稳定窗口”：只要后续还有关键词/embedding 等变化，就继续推迟；最终只提交一次
      txnSettleTimerRef.current = window.setTimeout(() => {
        const pending = pendingLayoutRef.current;
        if (!pending) return;

        const newIds = [...txnNewIdsRef.current];
        txnNewIdsRef.current = new Set();

        // 清理入场状态：新的 txn 开始时视为新一轮
        if (newNoteAnimTimersRef.current.show) window.clearTimeout(newNoteAnimTimersRef.current.show);
        if (newNoteAnimTimersRef.current.clear) window.clearTimeout(newNoteAnimTimersRef.current.clear);
        setEnteringNewIds([]);

        // 先隐藏新方块 -> commit 最终布局（旧方块会移动到最终位置）-> 再挤出新方块
        if (newIds.length) {
          const merged = new Set([...heldNewIdsRef.current, ...newIds]);
          heldNewIdsRef.current = merged;
          setHeldNewIds([...merged]);
        }

        committedLayoutRef.current = pending;
        setCommittedLayout(pending);

        if (newIds.length) {
          newNoteAnimTimersRef.current.show = window.setTimeout(() => {
            const ids = [...heldNewIdsRef.current];
            heldNewIdsRef.current = new Set();
            setHeldNewIds([]);
            setEnteringNewIds(ids);
            newNoteAnimTimersRef.current.clear = window.setTimeout(() => {
              setEnteringNewIds([]);
            }, WORKSPACE_ENTER_MS);
          }, WORKSPACE_MOVE_MS);
        }

        txnSettleTimerRef.current = null;
      }, WORKSPACE_LAYOUT_BATCH_MS);

      return () => {
        if (txnSettleTimerRef.current) {
          window.clearTimeout(txnSettleTimerRef.current);
          txnSettleTimerRef.current = null;
        }
      };
    }

    // 未开启新增动画（首次加载/刷新阶段）：
    // 即便出现“added”（通常是后端初始数据拉取），也只做普通 commit，不触发挤出动画。
    if (added.length && !allowNewNoteAnimRef.current) {
      txnNewIdsRef.current = new Set();
      heldNewIdsRef.current = new Set();
      setHeldNewIds([]);
      setEnteringNewIds([]);
      committedLayoutRef.current = pendingLayoutRef.current;
      setCommittedLayout(pendingLayoutRef.current);
      return;
    }

    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }

    commitTimerRef.current = window.setTimeout(() => {
      const prevCommitted = committedLayoutRef.current;
      const prevIds = new Set((prevCommitted?.placed ?? []).map((p) => p.note._id));
      const pending = pendingLayoutRef.current;
      if (!pending) return;
      const nextIds = new Set(pending.placed.map((p) => p.note._id));

      const added: string[] = [];
      for (const id of nextIds) if (!prevIds.has(id)) added.push(id);

      // 先清理入场状态：新的 commit 发生时，视为新一轮动画周期
      if (newNoteAnimTimersRef.current.show) window.clearTimeout(newNoteAnimTimersRef.current.show);
      if (newNoteAnimTimersRef.current.clear) window.clearTimeout(newNoteAnimTimersRef.current.clear);
      setEnteringNewIds([]);

      // 新增笔记：先隐藏它们（留出“人群挤开”的感觉）
      if (added.length) {
        const merged = new Set([...heldNewIdsRef.current, ...added]);
        heldNewIdsRef.current = merged;
        setHeldNewIds([...merged]);
      }

      const nextLayout = pending;
      committedLayoutRef.current = nextLayout;
      setCommittedLayout(nextLayout);

      // 再在移动结束后显示新增笔记，并播放入场动画
      if (added.length) {
        newNoteAnimTimersRef.current.show = window.setTimeout(() => {
          const ids = [...heldNewIdsRef.current];
          heldNewIdsRef.current = new Set();
          setHeldNewIds([]);
          setEnteringNewIds(ids);
          newNoteAnimTimersRef.current.clear = window.setTimeout(() => {
            setEnteringNewIds([]);
          }, WORKSPACE_ENTER_MS);
        }, WORKSPACE_MOVE_MS);
      }

      commitTimerRef.current = null;
    }, WORKSPACE_LAYOUT_BATCH_MS);

    return () => {
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    };
  }, [computedClusters, computedPlaced, frozenLayout, isWorkspaceOverlayOpen]);

  const clusterAvgColor = useMemo(() => {
    const acc = new Map<string, { r: number; g: number; b: number; a: number; n: number }>();
    for (const p of visiblePlaced) {
      const parsed = parseRgba(p.displayColor);
      if (!parsed) continue;
      const cur = acc.get(p.cluster.key) || { r: 0, g: 0, b: 0, a: 0, n: 0 };
      cur.r += parsed.r;
      cur.g += parsed.g;
      cur.b += parsed.b;
      cur.a += parsed.a;
      cur.n += 1;
      acc.set(p.cluster.key, cur);
    }
    const out = new Map<string, string>();
    for (const [k, v] of acc.entries()) {
      if (v.n <= 0) continue;
      out.set(k, rgbaToString({ r: v.r / v.n, g: v.g / v.n, b: v.b / v.n, a: v.a / v.n }));
    }
    return out;
  }, [visiblePlaced]);

  const clusterLegend = useMemo(() => {
    // 与布局一致：按簇大小加权分配扇区（顺序沿用 clusters 的顺序）
    const total = clusters.reduce((s, c) => s + c.notes.length, 0) || 1;
    return clusters.map((c) => {
      const frac = c.notes.length / total;
      const avg = clusterAvgColor.get(c.key);
      // avg 来自真实方块颜色统计（避免图例与方块产生色差）
      return {
        key: c.key,
        count: c.notes.length,
        frac,
        avgColor: avg || 'rgba(148, 163, 184, 0.55)',
      };
    });
  }, [clusters, clusterAvgColor]);

  const legendStripGradient = useMemo(() => {
    // 一条“连续渐变”的色带：按簇占比在 0..100% 放置颜色控制点
    // 注意：这里不做分段纯色，而是让相邻簇之间自然插值过渡
    if (clusterLegend.length === 0) return undefined;
    let acc = 0;
    const stops: string[] = [];
    // 起点
    stops.push(`${clusterLegend[0].avgColor} 0%`);
    for (const c of clusterLegend) {
      acc += c.frac;
      const p = Math.max(0, Math.min(100, acc * 100));
      stops.push(`${c.avgColor} ${p.toFixed(3)}%`);
    }
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }, [clusterLegend]);

  // 仅调试：当布局（聚类/装箱/颜色）重新计算时，在浏览器控制台打印一次
  const layoutDebugSig = useMemo(() => {
    const idsHash = notes.reduce((acc, n) => acc ^ hashStringToInt(n._id), 0) >>> 0;
    const kwHash = notes.reduce((acc, n) => {
      const kws = Array.isArray(n.keywords) ? n.keywords.join('|') : '';
      return (acc ^ hashStringToInt(kws)) >>> 0;
    }, 0) >>> 0;
    const embCount = notes.reduce((c, n) => c + (Array.isArray((n as any).embedding) && (n as any).embedding.length > 0 ? 1 : 0), 0);
    return `${notes.length}|${clusters.length}|${gridCols}|${placed.length}|${embCount}|${idsHash.toString(16)}|${kwHash.toString(16)}`;
  }, [notes, clusters.length, gridCols, placed.length]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const embCount = notes.reduce((c, n) => c + (Array.isArray((n as any).embedding) && (n as any).embedding.length > 0 ? 1 : 0), 0);
    console.log('[WorkspaceGrid] ✅ 已重新排列/重算布局', {
      at: new Date().toISOString(),
      notes: notes.length,
      clusters: clusters.length,
      gridCols,
      placed: placed.length,
      notesWithEmbedding: embCount,
      sig: layoutDebugSig,
    });
  }, [layoutDebugSig, notes.length, clusters.length, gridCols, placed.length]);

  // 同步：历史列表 hover 也应该触发工作区的“膨胀 + 挤压”效果
  useEffect(() => {
    setGridHoverId(hoveredNoteId || null);
  }, [hoveredNoteId]);

  // 同步：hover 历史笔记 / 长方块 -> 图例 hover 效果（高亮/文字/过滤）也同步
  useEffect(() => {
    const id = hoveredNoteId || gridHoverId;
    if (!id) {
      setExternalHoverKey(null);
      return;
    }
    setExternalHoverKey(noteIdToClusterKey.get(id) || null);
  }, [hoveredNoteId, gridHoverId, noteIdToClusterKey]);

  // hover “膨胀 + 挤压周围方块”效果：根据距离给周围方块施加轻微位移（push）
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    rafRef.current = requestAnimationFrame(() => {
      const hovered = gridHoverId ? cellRefs.current.get(gridHoverId) : null;

      // reset
      for (const [, el] of cellRefs.current) {
        el.style.removeProperty('--ws-tx');
        el.style.removeProperty('--ws-ty');
        el.style.removeProperty('--ws-scale');
        el.style.removeProperty('--ws-z');
        el.style.removeProperty('--ws-dim');
      }

      if (!hovered) return;

      const hr = hovered.getBoundingClientRect();
      const hx = hr.left + hr.width / 2;
      const hy = hr.top + hr.height / 2;

      // 半径内产生“挤压”：半径越近推得越开
      const R = 140; // px
      const S = 18; // px 最大位移强度

      for (const [, el] of cellRefs.current) {
        if (el === hovered) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = cx - hx;
        const dy = cy - hy;
        const dist = Math.hypot(dx, dy);
        if (!isFinite(dist) || dist <= 0 || dist > R) continue;

        const t = (R - dist) / R; // 0..1
        const nx = dx / dist;
        const ny = dy / dist;
        const push = S * t * t; // 更像“弹簧挤压”的衰减
        const tx = nx * push;
        const ty = ny * push;
        el.style.setProperty('--ws-tx', `${tx.toFixed(2)}px`);
        el.style.setProperty('--ws-ty', `${ty.toFixed(2)}px`);
        el.style.setProperty('--ws-dim', `${(0.02 + 0.06 * t).toFixed(3)}`); // 轻微降亮度，突出中心
      }

      hovered.style.setProperty('--ws-scale', '1.18');
      hovered.style.setProperty('--ws-z', '2');
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [gridHoverId, placed.length]);

  // 重排动画（FLIP）：每次“可见布局”变化都让方块从旧位置平滑移动到新位置
  useLayoutEffect(() => {
    const prev = prevRectsRef.current;
    const next = new Map<string, DOMRect>();

    // 先读取新 rect（避免读写交错造成强制重排）
    for (const [id, el] of cellRefs.current.entries()) {
      next.set(id, el.getBoundingClientRect());
    }

    // 1) Invert：把元素瞬间挪回旧位置（必须禁用 transition），视觉上“不跳”
    const touched: HTMLElement[] = [];
    for (const [id, el] of cellRefs.current.entries()) {
      const a = prev.get(id);
      const b = next.get(id);
      if (!a || !b) continue;
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (!isFinite(dx) || !isFinite(dy)) continue;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      // 禁用 transition（否则 invert 本身也会被动画化，导致“看不到移动”）
      (el as unknown as HTMLElement).style.transition = 'none';
      (el as unknown as HTMLElement).style.setProperty('--ws-flip-x', `${dx.toFixed(2)}px`);
      (el as unknown as HTMLElement).style.setProperty('--ws-flip-y', `${dy.toFixed(2)}px`);
      touched.push(el as unknown as HTMLElement);
    }

    // 2) 强制 reflow：确保上面的 “transition:none + invert” 被应用
    //    只读一次也会触发布局刷新（touched 可能为空）
    if (touched.length) touched[0].getBoundingClientRect();

    // 3) Play：恢复 transition，并把偏移归零 -> 平滑移动到新位置
    const raf = requestAnimationFrame(() => {
      for (const el of touched) {
        el.style.transition = '';
        el.style.setProperty('--ws-flip-x', `0px`);
        el.style.setProperty('--ws-flip-y', `0px`);
      }
    });

    prevRectsRef.current = next;
    return () => cancelAnimationFrame(raf);
  }, [visiblePlaced]);

  return (
    <div
      ref={workspaceScrollRef}
      className={styles.workspaceScroll}
      aria-label="笔记工作区网格"
    >
      {fixedContainer && (
        <>
          {/* 图例：仅在“工作台未打开”时显示（避免与工作台/联想面板冲突） */}
          {!shouldShowRecommendDock && (
            <div
              className={styles.workspaceLegendDock}
              style={{
                top: Math.max(fixedContainer.top + 12, topNavBottom + 12),
                // 靠右对齐（与视口右侧对齐）
                right: 18,
                left: 'auto',
                // 让图例更靠右：收紧 dock 宽度（避免看起来偏向页面中心）
                width: 240,
              }}
            >
              <div
                className={styles.workspaceLegend}
                aria-label="簇图例"
                onMouseEnter={() => {
                  if (legendCloseTimerRef.current) {
                    window.clearTimeout(legendCloseTimerRef.current);
                    legendCloseTimerRef.current = null;
                  }
                }}
                onMouseLeave={() => {
                  if (!legendOpen) return;
                  // 关闭稍微延迟一点点，避免误关
                  if (legendCloseTimerRef.current) window.clearTimeout(legendCloseTimerRef.current);
                  legendCloseTimerRef.current = window.setTimeout(() => {
                    setLegendOpen(false);
                    legendCloseTimerRef.current = null;
                  }, 220);
                }}
              >
                {hoverLabelKey && <div className={styles.workspaceLegendHoverLabel}>{hoverLabelKey}</div>}
                <div
                  className={styles.workspaceLegendStrip}
                  aria-label="簇连续色带"
                  style={legendStripGradient ? { backgroundImage: legendStripGradient } : undefined}
                  onClick={() => setLegendOpen((v) => !v)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setLegendOpen((v) => !v);
                    }
                  }}
                  title={legendOpen ? '点击收起簇列表' : '点击展开簇列表'}
                >
                  {clusterLegend.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      className={`${styles.workspaceLegendSeg} ${legendClusterKey === c.key ? styles.workspaceLegendSegActive : ''}`}
                      style={{ flex: `${Math.max(0.0001, c.frac)}` }}
                      onMouseEnter={() => setLegendHoverKey(c.key)}
                      onMouseLeave={() => setLegendHoverKey((cur) => (cur === c.key ? null : cur))}
                      title={`${c.key}（${c.count}）`}
                      aria-label={`${c.key}（${c.count}）`}
                    >
                      {/* overlay only: 背景由整条色带统一渲染，以保证“连续渐变” */}
                    </button>
                  ))}
                </div>
                {legendOpen && (
                  <div className={styles.workspaceLegendList}>
                    {clusterLegend.map((c) => (
                      <div
                        key={c.key}
                        className={`${styles.workspaceLegendItem} ${legendClusterKey === c.key ? styles.workspaceLegendItemActive : ''}`}
                        onMouseEnter={() => setLegendHoverKey(c.key)}
                        onMouseLeave={() => setLegendHoverKey((cur) => (cur === c.key ? null : cur))}
                        title={`${c.key}（${c.count}）`}
                      >
                        <span className={styles.workspaceLegendSwatch} style={{ background: c.avgColor }} />
                        <span className={styles.workspaceLegendLabel}>{c.key}</span>
                        <span className={styles.workspaceLegendMeta}>{c.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 联想列表：仅在“工作台打开”时显示；顶部与工作台顶部对齐 */}
          {shouldShowRecommendDock && (
            <div
              className={styles.workspaceRecommendDock}
              style={{
                top: fixedContainer.top,
                left: fixedContainer.left + fixedContainer.width + 18,
                right: 'auto',
                width: (() => {
                  const RIGHT_PAD = 18;
                  const vw = viewportW || window.innerWidth;
                  const startX = fixedContainer.left + fixedContainer.width + 18;
                  const max = Math.max(200, vw - startX - RIGHT_PAD);
                  return Math.max(260, Math.min(360, max));
                })(),
              }}
              aria-label="联想面板"
            >
              <ul className={styles.workspaceRecommendList} aria-label="联想笔记列表">
                {recommendations.map((r, idx) => {
                  const title = (r.note.title || '').trim() || '未命名';
                  const body = (r.note.summary || r.note.contentText || r.note.content || '').trim();
                  const reason = (r.reason || '').trim() || '联想理由：';
                  return (
                    <li
                      key={r.note._id}
                      className={styles.workspaceRecommendItem}
                      style={{ animationDelay: `${idx * 0.8}s` }}
                    >
                      <div
                        className={styles.workspaceRecommendCard}
                        onClick={() => onSelect(r.note._id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelect(r.note._id);
                          }
                        }}
                      >
                        <span className={styles.workspaceRecommendAccent} aria-hidden="true" />
                        <div className={styles.workspaceRecommendContent}>
                          <div className={styles.workspaceRecommendTitleRow}>
                            <div className={styles.workspaceRecommendTitle}>{title}</div>
                          </div>
                          <div className={styles.workspaceRecommendReason}>{reason}</div>
                          <div className={styles.workspaceRecommendBody}>{body}</div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* 网格：固定坐标容器（只负责网格区域） */}
          <div
            ref={gridElRef}
            className={styles.workspaceGrid}
            role="grid"
            aria-rowcount={undefined}
            aria-colcount={undefined}
            style={{
              left: fixedContainer.left,
              top: fixedContainer.top,
              width: fixedContainer.width,
              height: fixedContainer.height,
            }}
          >
            {visiblePlaced.map(({ note, cluster, idxInCluster, row, col, palette, displayColor }) => {
          const isSelected = selectedNoteId === note._id;
          const isHovered = hoveredNoteId === note._id;
          const isClusterHovered = Boolean(legendClusterKey && legendClusterKey === cluster.key);
          const isEntering = enteringNewIdSet.has(note._id);
          const isDeleting = deletingIdSet.has(note._id);
          const title = (note.title || '').trim() || '未命名';
          const kws = getKeywords(note);
          const color = displayColor;
          const dimmed = legendClusterKey
            ? legendClusterKey !== cluster.key // 图例 hover：按簇 dim
            : Boolean(singleFocusId && singleFocusId !== note._id); // 方块/历史 hover：只聚焦单个方块（带清空延迟）
          const crowdDim = enteringNewIdSet.size > 0 && !isEntering ? 0.56 : 1;
          const baseOpacity = dimmed ? 0.22 : 1;

          return (
            <button
              key={note._id}
              type="button"
              role="gridcell"
              className={`${styles.workspaceCell} ${isSelected ? styles.workspaceCellSelected : ''} ${
                isClusterHovered ? styles.workspaceCellClusterHovered : ''
              } ${isHovered ? styles.workspaceCellHovered : ''} ${
                isEntering ? styles.workspaceCellEntering : ''
              } ${isDeleting ? styles.workspaceCellDeleting : ''}`}
              style={{
                // 用内联色值，避免生成大量 class
                ['--ws-bg' as any]: color,
                gridRowStart: row + 1,
                gridColumnStart: col + 1,
                opacity: isSelected ? 1 : baseOpacity * crowdDim,
              }}
              onClick={() => onSelect(note._id)}
              disabled={isDeleting}
              ref={(el) => {
                if (!el) {
                  cellRefs.current.delete(note._id);
                } else {
                  cellRefs.current.set(note._id, el);
                }
              }}
              onMouseEnter={() => {
                setGridHoverId(note._id);
                onHover?.(note._id);

                // tooltip：三段式
                // 1) hover 0.8s 后出现（只显示标题）
                // 2) 出现后 1s 做边缘 loading（进度条），结束后自动展开
                // 3) 展开后展示更多信息
                if (!selectedNoteId) {
                  if (tipShowTimerRef.current) window.clearTimeout(tipShowTimerRef.current);
                  if (tipExpandTimerRef.current) window.clearTimeout(tipExpandTimerRef.current);
                  tipShowTimerRef.current = null;
                  tipExpandTimerRef.current = null;

                  // 立即隐藏旧 tooltip，避免快速划过时“残留在旧位置”
                  setTipId(null);
                  setTipExpanded(false);
                  setTipPos(null);

                  tipShowTimerRef.current = window.setTimeout(() => {
                    setTipId(note._id);
                    setTipExpanded(false);
                    tipShowTimerRef.current = null;

                    // 出现后：1.0s 进度条跑完 + 0.1s 缓冲，再展开
                    tipExpandTimerRef.current = window.setTimeout(() => {
                      setTipExpanded(true);
                      tipExpandTimerRef.current = null;
                    }, 1100);
                  }, 800);
                }
              }}
              onMouseLeave={() => {
                setGridHoverId((cur) => (cur === note._id ? null : cur));
                onHover?.(null);

                if (tipShowTimerRef.current) window.clearTimeout(tipShowTimerRef.current);
                tipShowTimerRef.current = null;
                if (tipExpandTimerRef.current) window.clearTimeout(tipExpandTimerRef.current);
                tipExpandTimerRef.current = null;
                setTipId((cur) => (cur === note._id ? null : cur));
                setTipExpanded(false);
                setTipPos(null);
              }}
              aria-label={title}
            >
              <span className={styles.workspaceCellInner} />
              {isDeleting && (
                <span className={styles.workspaceCellShards} aria-hidden="true">
                  {Array.from({ length: 11 }).map((_, i) => (
                    <span key={i} className={styles.workspaceCellShard} />
                  ))}
                </span>
              )}
            </button>
          );
            })}
          </div>
        </>
      )}

      {/* Tooltip（渲染到 body portal） */}
      {tipPortalElRef.current &&
        tipId &&
        tipPos &&
        (() => {
          const found = visiblePlaced.find((p) => p.note._id === tipId);
          if (!found) return null;
          const title = (found.note.title || '').trim() || '未命名';
          const kws = getKeywords(found.note);
          const preview = (found.note.contentText || found.note.content || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 72);

          return createPortal(
            <div
              className={`${styles.workspaceHoverTip} ${
                tipPos.place === 'top' ? styles.workspaceHoverTipTop : styles.workspaceHoverTipBottom
              } ${tipExpanded ? styles.workspaceHoverTipExpanded : ''} ${!tipExpanded ? styles.workspaceHoverTipLoading : ''}`}
              style={{
                left: `${tipPos.x}px`,
                top: `${tipPos.y}px`,
                ['--ws-tip-accent' as any]: found.displayColor,
                ...(tipBox ? ({ ['--ws-tip-perimeter' as any]: `${tipBox.perimeter}` } as any) : null),
              }}
              ref={tipElRef}
              aria-hidden="true"
            >
              {!tipExpanded && (
                <svg
                  className={styles.workspaceHoverTipProgress}
                  viewBox={`0 0 ${tipBox?.w ?? 100} ${tipBox?.h ?? 60}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <rect
                    className={styles.workspaceHoverTipProgressRect}
                    x="1.5"
                    y="1.5"
                    width={(tipBox?.w ?? 100) - 3}
                    height={(tipBox?.h ?? 60) - 3}
                    rx="14"
                    ry="14"
                  />
                </svg>
              )}
              <div className={styles.workspaceHoverTipHeader}>
                <span className={styles.workspaceHoverTipDot} />
                <span className={styles.workspaceHoverTipTitle}>{title}</span>
              </div>
              <div className={styles.workspaceHoverTipExpand}>
                <div className={styles.workspaceHoverTipMeta}>簇：{found.cluster.key}</div>
                {preview ? <div className={styles.workspaceHoverTipPreview}>{preview}</div> : null}
                {kws.length ? (
                  <div className={styles.workspaceHoverTipKws}>
                    {kws.slice(0, 3).map((k) => (
                      <span key={k} className={styles.workspaceHoverTipKw}>
                        {k}
                      </span>
                    ))}
                    {kws.length > 3 ? (
                      <span className={styles.workspaceHoverTipKwMore}>+{kws.length - 3}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>,
            tipPortalElRef.current
          );
        })()}
    </div>
  );
}

