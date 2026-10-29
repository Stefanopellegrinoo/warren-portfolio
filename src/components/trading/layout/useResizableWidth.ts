"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

/**
 * The list's width beside the chart (odd/tasks/chart-pro-redesign.md S5): its left edge is dragged,
 * 220–640 px, never leaving the chart under 420 px, kept per device; a double click goes back to
 * 280 px. Below 1100 px the list is full width in its own view: nothing to drag, only its width read.
 */
const STORAGE_KEY = "warren:watchlist-width";
const DEFAULT_PX = 280;
const MIN_PX = 220;
const MAX_PX = 640;
const KEY_STEP_PX = 16;
// The chart keeps at least 420 px next to its drawing rail (~48 px).
const CHART_ROOM_PX = 420 + 48;
const WIDE = "(min-width: 1100px)";

function readWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return saved >= MIN_PX && saved <= MAX_PX ? saved : DEFAULT_PX;
  } catch {
    // No storage (private mode, blocked site data, the server): the default.
    return DEFAULT_PX;
  }
}

function saveWidth(width: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Same: this visit only.
  }
}

// jsdom and the server have no matchMedia: narrow, as today.
const isWide = () => typeof window.matchMedia === "function" && window.matchMedia(WIDE).matches;
function subscribeWide(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** `panel` is the resized element; its parent is the row it shares with the chart. */
export function useResizableWidth(panel: RefObject<HTMLElement>) {
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const [stored, setStored] = useState(readWidth);
  // What the list really takes: the CSS cap below can hold it under the stored width, and below
  // 1100 px it is the full-width view, or 0 while hidden behind the chart.
  const [shown, setShown] = useState<number | null>(null);
  const [max, setMax] = useState(MAX_PX);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; from: number; max: number; to: number } | null>(null);

  useEffect(() => {
    const el = panel.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setShown(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [panel]);

  // Until measured: the stored width beside the chart, nothing below 1100 px.
  const width = shown ?? (wide ? stored : 0);

  // Read from the layout when the user acts: the app menu may be 64 or 264 px wide.
  const limit = () => {
    const row = panel.current?.parentElement?.clientWidth ?? Infinity;
    const m = Math.max(MIN_PX, Math.min(MAX_PX, row - CHART_ROOM_PX));
    setMax(m);
    return m;
  };
  const clamp = (w: number, m: number) => Math.round(Math.max(MIN_PX, Math.min(m, w)));
  const commit = (w: number) => {
    setStored(w);
    saveWidth(w);
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    document.body.style.cursor = "";
    commit(d.to);
  };

  const separatorProps = {
    role: "separator",
    "aria-orientation": "vertical" as const,
    "aria-label": "Ancho de la lista",
    "aria-valuenow": width,
    "aria-valuemin": MIN_PX,
    "aria-valuemax": max,
    tabIndex: 0,
    title: "Arrastrá para cambiar el ancho · doble clic: ancho original",
    "data-dragging": dragging || undefined,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, from: width, max: limit(), to: width };
      setDragging(true);
      document.body.style.cursor = "col-resize";
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      // The edge is on the left: moving it left widens the list.
      d.to = clamp(d.from + d.x - e.clientX, d.max);
      setStored(d.to);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onDoubleClick: () => commit(DEFAULT_PX),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const step = e.key === "ArrowLeft" ? KEY_STEP_PX : e.key === "ArrowRight" ? -KEY_STEP_PX : 0;
      if (!step) return;
      e.preventDefault();
      commit(clamp(width + step, limit()));
    },
  };

  // Inline only from 1100 px; the cap keeps the chart's room when the menu or the window changes later.
  const style: CSSProperties | undefined = wide ? { width: stored, maxWidth: `calc(100% - ${CHART_ROOM_PX}px)` } : undefined;

  return { wide, width, style, separatorProps };
}
