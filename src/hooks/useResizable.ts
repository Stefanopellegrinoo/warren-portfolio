import { useState, useEffect, useRef } from "react";

// ── Pure utility exports (exported for unit testing) ──────────────────────────

/**
 * Clamps a width value between min and max (inclusive).
 */
export function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Reads a stored width from localStorage.
 * Returns null when the key is absent or the stored value is not a valid number.
 */
export function getStoredWidth(storageKey: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(storageKey);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (isNaN(parsed)) return null;
  return parsed;
}

export interface UseResizableOptions {
  min: number;
  max: number;
  default: number;
  storageKey: string;
}

export interface UseResizableReturn {
  width: number;
  handleProps: React.HTMLAttributes<HTMLDivElement>;
}

export function useResizable(opts: UseResizableOptions): UseResizableReturn {
  const [width, setWidth] = useState(opts.default);
  const startX = useRef(0);
  const startWidth = useRef(opts.default);
  const isDragging = useRef(false);

  // Restore persisted width from localStorage after mount (SSR-safe)
  useEffect(() => {
    const stored = getStoredWidth(opts.storageKey);
    if (stored !== null) {
      setWidth(clampWidth(stored, opts.min, opts.max));
    }
  // opts members are stable — only run on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging.current) return;
    const delta = e.clientX - startX.current;
    const newWidth = clampWidth(startWidth.current - delta, opts.min, opts.max);
    setWidth(newWidth);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging.current) return;
    isDragging.current = false;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    if (typeof window !== "undefined") {
      globalThis.localStorage.setItem(opts.storageKey, String(width));
    }
  }

  return {
    width,
    handleProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
    },
  };
}
