const PROSE_MIRROR_SELECTOR = '.ProseMirror';

type FocusPosition = 'start' | 'end';

function placeCaret(editable: HTMLElement, position: FocusPosition) {
  const selection = window.getSelection();
  if (!selection) return;

  const activeRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (activeRange && editable.contains(activeRange.startContainer) && editable.contains(activeRange.endContainer)) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(position === 'start');
  selection.removeAllRanges();
  selection.addRange(range);
}

export function focusProseMirrorWithin(
  root: ParentNode | null,
  options: {
    retries?: number;
    position?: FocusPosition;
  } = {}
) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const { retries = 12, position = 'end' } = options;
  let frameId = 0;
  let cancelled = false;
  let attempts = 0;

  const tryFocus = () => {
    if (cancelled) return;

    const editable = root?.querySelector(PROSE_MIRROR_SELECTOR) as HTMLElement | null;
    if (!editable || !editable.isConnected) {
      if (attempts < retries) {
        attempts += 1;
        frameId = window.requestAnimationFrame(tryFocus);
      }
      return;
    }

    editable.focus({ preventScroll: true });
    placeCaret(editable, position);
  };

  frameId = window.requestAnimationFrame(tryFocus);

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frameId);
  };
}
