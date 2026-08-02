import { useCallback, useRef, useState, type PointerEvent } from "react";

interface UseSwipeActionOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Fraction of the element's own width the drag must cross to commit. */
  thresholdRatio?: number;
}

interface SwipeBind {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
}

// Hand-rolled horizontal swipe (no gesture library — see Stage 4 mobile-polish
// plan: the main bundle has ~14% headroom against its 260KB gzip budget).
// Drag follows the pointer via `offsetX`; releasing past `thresholdRatio` of
// the element's width fires the matching callback, otherwise it springs back.
export function useSwipeAction({ onSwipeLeft, onSwipeRight, thresholdRatio = 0.25 }: UseSwipeActionOptions) {
  const ref = useRef<HTMLDivElement>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const width = useRef(1);
  const pointerId = useRef<number | null>(null);

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerId.current = e.pointerId;
    startX.current = e.clientX;
    width.current = ref.current?.offsetWidth || 1;
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    if (pointerId.current !== e.pointerId) return;
    setOffsetX(e.clientX - startX.current);
  }, []);

  const release = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (pointerId.current !== e.pointerId) return;
      pointerId.current = null;
      setDragging(false);
      const threshold = width.current * thresholdRatio;
      if (offsetX > threshold) onSwipeRight?.();
      else if (offsetX < -threshold) onSwipeLeft?.();
      setOffsetX(0);
    },
    [offsetX, onSwipeLeft, onSwipeRight, thresholdRatio]
  );

  const bind: SwipeBind = {
    onPointerDown,
    onPointerMove,
    onPointerUp: release,
    onPointerCancel: release,
  };

  return { ref, bind, offsetX, dragging };
}
