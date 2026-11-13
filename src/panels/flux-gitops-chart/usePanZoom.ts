import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface View {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;
const STEP = 1.25;
/** A pointer that moves less than this is a click, not a drag. */
const DRAG_PX = 4;
/** How much of the content stays on screen however far it is dragged. */
const KEEP_PX = 48;
const MARGIN = 16;

const INITIAL: View = { x: 0, y: 0, k: 1 };

const clampK = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** A card, button or link: a press there is never a double-click on empty canvas. */
const onCard = (t: EventTarget | null): boolean =>
  t instanceof Element && t.closest('[role="treeitem"], button, a, input') !== null;

export interface PanZoom {
  view: View;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  reset: () => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
}

/**
 * Pan and zoom by CSS transform, no dependency: wheel and pinch zoom on the cursor, a drag pans (and is
 * never taken as a click), double-click on empty canvas fits. `page` resets the view when it changes;
 * `size` is the content's size at 100%.
 */
export function usePanZoom(
  viewportRef: RefObject<HTMLDivElement | null>,
  page: string,
  size: { width: number; height: number },
): PanZoom {
  const [view, setView] = useState<View>(INITIAL);
  // A new page starts at 100%, top left.
  const [shownPage, setShownPage] = useState(page);
  if (shownPage !== page) {
    setShownPage(page);
    setView(INITIAL);
  }
  const sizeRef = useRef(size);
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    sizeRef.current = size;
    viewRef.current = view;
  });

  const clampView = useCallback(
    (v: View): View => {
      const el = viewportRef.current;
      if (el === null) return v;
      const w = sizeRef.current.width * v.k;
      const h = sizeRef.current.height * v.k;
      const minX = Math.min(0, KEEP_PX - w);
      const minY = Math.min(0, KEEP_PX - h);
      const maxX = Math.max(0, el.clientWidth - KEEP_PX);
      const maxY = Math.max(0, el.clientHeight - KEEP_PX);
      return { k: v.k, x: Math.min(maxX, Math.max(minX, v.x)), y: Math.min(maxY, Math.max(minY, v.y)) };
    },
    [viewportRef],
  );

  /** Zoom to `k`, keeping the content point under (cx, cy) in place. */
  const zoomAt = useCallback(
    (k: number, cx?: number, cy?: number) =>
      setView((v) => {
        const el = viewportRef.current;
        const px = cx ?? (el?.clientWidth ?? 0) / 2;
        const py = cy ?? (el?.clientHeight ?? 0) / 2;
        const nk = clampK(k);
        return clampView({ k: nk, x: px - ((px - v.x) * nk) / v.k, y: py - ((py - v.y) * nk) / v.k });
      }),
    [clampView, viewportRef],
  );

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (el === null) return;
    const { width, height } = sizeRef.current;
    if (width <= 0 || height <= 0) return;
    // Content that already fits stays at real size; larger content shrinks to fit with a margin.
    const fits = width <= el.clientWidth && height <= el.clientHeight;
    const k = fits
      ? 1
      : clampK(Math.min(1, (el.clientWidth - MARGIN * 2) / width, (el.clientHeight - MARGIN * 2) / height));
    setView({
      k,
      x: Math.max(0, (el.clientWidth - width * k) / 2),
      y: Math.max(0, (el.clientHeight - height * k) / 2),
    });
  }, [viewportRef]);

  const reset = useCallback(() => setView(INITIAL), []);
  const zoomBy = useCallback((f: number) => zoomAt(viewRef.current.k * f), [zoomAt]);

  useEffect(() => {
    const el = viewportRef.current;
    if (el === null) return undefined;

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // Pinch on a trackpad arrives as a wheel with ctrlKey and small deltas; a mouse wheel as larger steps.
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const f = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002));
      zoomAt(viewRef.current.k * f, e.clientX - r.left, e.clientY - r.top);
    };

    // Pointers down on the canvas: one drags, two pinch.
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; view: View } | undefined;
    let pinch: { d: number; k: number } | undefined;
    let dragged = false;

    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 || (e.target instanceof Element && e.target.closest('input') !== null)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY, view: viewRef.current };
        dragged = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), k: viewRef.current.k };
        dragged = true;
      }
    };
    const onMove = (e: PointerEvent): void => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch !== undefined && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const r = el.getBoundingClientRect();
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch.d > 0) zoomAt((pinch.k * d) / pinch.d, (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top);
        return;
      }
      if (start === undefined) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < DRAG_PX) return;
      if (!dragged) {
        dragged = true;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
      }
      setView(clampView({ k: start.view.k, x: start.view.x + dx, y: start.view.y + dy }));
    };
    const onUp = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = undefined;
      if (pointers.size === 0) {
        start = undefined;
        el.style.cursor = '';
      }
    };
    // The click that ends a drag never reaches a card.
    const onClick = (e: MouseEvent): void => {
      if (!dragged) return;
      dragged = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const onDblClick = (e: MouseEvent): void => {
      if (!onCard(e.target)) fit();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('click', onClick, true);
    el.addEventListener('dblclick', onDblClick);
    return (): void => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('dblclick', onDblClick);
    };
  }, [zoomAt, clampView, fit, viewportRef]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') zoomBy(STEP);
      else if (e.key === '-' || e.key === '−' || e.key === '_') zoomBy(1 / STEP);
      else if (e.key === '0') reset();
      else return;
      e.preventDefault();
    },
    [zoomBy, reset],
  );

  return {
    view,
    zoomIn: () => zoomBy(STEP),
    zoomOut: () => zoomBy(1 / STEP),
    fit,
    reset,
    onKeyDown,
  };
}
