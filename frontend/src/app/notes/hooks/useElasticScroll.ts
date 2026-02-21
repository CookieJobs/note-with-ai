import { useEffect, useRef } from 'react';

export function useElasticScroll(scrollRef: React.RefObject<HTMLDivElement | null>) {
  const historyBounceLockRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let offset = 0;
    let rafId: number | null = null;
    let bounceTimer: number | null = null;

    const applyTransform = () => {
      el.style.transform = Math.abs(offset) > 0.5 ? `translateY(${offset}px)` : '';
    };

    const release = () => {
      if (rafId) cancelAnimationFrame(rafId);
      const from = offset;
      const start = performance.now();
      const dur = 220;
      const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

      const step = (now: number) => {
        const p = Math.min(1, (now - start) / dur);
        offset = from * (1 - easeOut(p));
        applyTransform();
        if (p < 1) {
          rafId = requestAnimationFrame(step);
        } else {
          offset = 0;
          applyTransform();
          rafId = null;
          historyBounceLockRef.current = false;
        }
      };
      rafId = requestAnimationFrame(step);
    };

    const onWheel = (e: WheelEvent) => {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      const nextScroll = el.scrollTop + e.deltaY;
      const overscrollTop = nextScroll < 0;
      const overscrollBottom = nextScroll > maxScroll;

      if (overscrollTop || overscrollBottom) {
        e.preventDefault();
        const dir = overscrollBottom ? -1 : 1;
        const next = offset + Math.abs(e.deltaY) * 0.08 * dir;
        offset = Math.max(-18, Math.min(18, next));
        applyTransform();
        historyBounceLockRef.current = true;
        if (bounceTimer) window.clearTimeout(bounceTimer);
        bounceTimer = window.setTimeout(() => release(), 50);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (rafId) cancelAnimationFrame(rafId);
      if (bounceTimer) window.clearTimeout(bounceTimer);
      el.style.transform = '';
      historyBounceLockRef.current = false;
    };
  }, [scrollRef]);

  return historyBounceLockRef;
}
