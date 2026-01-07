import { useCallback, useEffect, useRef } from 'react';

export function useComposeActionsA11y(options: {
  composeContainerRef: React.RefObject<HTMLDivElement | null>;
  composeActionsRef: React.RefObject<HTMLDivElement | null>;
  onExitComposing: () => void;
}) {
  const { composeContainerRef, composeActionsRef, onExitComposing } = options;
  const hideTimerRef = useRef<number | null>(null);

  const setActionsA11yHidden = useCallback((hidden: boolean) => {
    const actions = composeActionsRef.current;
    if (!actions) return;

    actions.setAttribute('aria-hidden', hidden ? 'true' : 'false');

    const focusables = actions.querySelectorAll<HTMLElement>('a[href], button, textarea, input, select, [tabindex]');
    focusables.forEach((el) => {
      if (hidden) {
        const prev = el.getAttribute('tabindex');
        if (prev !== null) el.setAttribute('data-prev-tabindex', prev);
        el.setAttribute('tabindex', '-1');
      } else {
        const prev = el.getAttribute('data-prev-tabindex');
        if (prev !== null) {
          if (prev === '') el.removeAttribute('tabindex');
          else el.setAttribute('tabindex', prev);
          el.removeAttribute('data-prev-tabindex');
        } else if (el.getAttribute('tabindex') === '-1') {
          el.removeAttribute('tabindex');
        }
      }
    });
  }, [composeActionsRef]);

  const handleComposeFocusCapture = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setActionsA11yHidden(false);
  }, [setActionsA11yHidden]);

  const handleComposeBlurCapture = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    const container = composeContainerRef.current;
    if (container && next && container.contains(next)) return; // 焦点仍在容器内

    onExitComposing();
    hideTimerRef.current = window.setTimeout(() => {
      setActionsA11yHidden(true);
    }, 120);
  }, [composeContainerRef, onExitComposing, setActionsA11yHidden]);

  // 初始时默认隐藏 actions（未激活）
  useEffect(() => {
    setActionsA11yHidden(true);
  }, [setActionsA11yHidden]);

  return {
    handleComposeFocusCapture,
    handleComposeBlurCapture,
  };
}


