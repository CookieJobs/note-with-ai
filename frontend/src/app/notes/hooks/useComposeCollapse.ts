import { useEffect, useMemo, useState } from 'react';

export function useComposeCollapse(
  scrollerRef: React.RefObject<HTMLElement | null>,
  isComposing: boolean,
  threshold: number = 1,
  forceCollapsed: boolean = false
) {
  const [composeCollapsed, setComposeCollapsed] = useState(false);

  useEffect(() => {
    if (forceCollapsed) {
      setComposeCollapsed(true);
      return;
    }
    const scroller = scrollerRef.current;
    if (!scroller) return;

    let ticking = false;
    const update = () => {
      // 规则：
      // - 向下滚动超过阈值：自动收缩
      // - 向上滚动：不自动展开（除非用户聚焦快速记录，此时 isComposing=true 或页面显式 setComposeCollapsed(false)）
      // - composing：始终展开
      if (isComposing) {
        setComposeCollapsed(false);
        ticking = false;
        return;
      }

      const shouldCollapse = scroller.scrollTop > threshold;
      if (!shouldCollapse) {
        ticking = false;
        return;
      }

      setComposeCollapsed((prev) => (prev ? prev : true));
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    scroller.addEventListener('scroll', onScroll);
    // 初始化一次
    if (!isComposing && scroller.scrollTop > threshold) setComposeCollapsed(true);

    return () => {
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [forceCollapsed, isComposing, scrollerRef, threshold]);

  const api = useMemo(
    () => ({
      composeCollapsed,
      setComposeCollapsed,
      expand: () => setComposeCollapsed(false),
      collapse: () => setComposeCollapsed(true),
      updateFromScroll: () => {
        if (forceCollapsed) {
          setComposeCollapsed(true);
          return;
        }
        const scroller = scrollerRef.current;
        if (!scroller) return;
        if (isComposing) {
          setComposeCollapsed(false);
          return;
        }
        if (scroller.scrollTop > threshold) setComposeCollapsed(true);
      },
    }),
    [composeCollapsed, forceCollapsed, isComposing, scrollerRef, threshold]
  );

  return api;
}


