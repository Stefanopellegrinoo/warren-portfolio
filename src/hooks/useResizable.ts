import { useState, useEffect, useRef } from "react";

/**
 * Clamps a width value between min and max (inclusive).
 */
export function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

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
  side?: "left" | "right";
}

export interface UseResizableReturn {
  width: number;
  handleProps: React.HTMLAttributes<HTMLDivElement>;
}

export function useResizable(opts: UseResizableOptions): UseResizableReturn {
  const [width, setWidth] = useState(opts.default);
  const isDragging = useRef(false);
  const startPos = useRef(0);
  const startWidth = useRef(0);
  const currentWidthRef = useRef(opts.default); // NEW: Track width outside state for persistence
  const side = opts.side ?? "left";

  // Sync ref with state
  useEffect(() => {
    currentWidthRef.current = width;
  }, [width]);

  // Restore persisted width
  useEffect(() => {
    const stored = getStoredWidth(opts.storageKey);
    if (stored !== null) {
      const val = clampWidth(stored, opts.min, opts.max);
      setWidth(val);
      currentWidthRef.current = val;
    }
  }, [opts.storageKey, opts.min, opts.max]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    isDragging.current = true;
    startPos.current = e.clientX;
    startWidth.current = width;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging.current) return;
    
    const delta = e.clientX - startPos.current;
    let nextWidth: number;
    
    if (side === "right") {
      nextWidth = startWidth.current - delta;
    } else {
      nextWidth = startWidth.current + delta;
    }

    const clamped = clampWidth(Math.round(nextWidth), opts.min, opts.max);
    setWidth(clamped);
    currentWidthRef.current = clamped;
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging.current) return;
    isDragging.current = false;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    
    document.body.style.cursor = "";
    document.body.style.userSelect = "";

    // Save final width using the ref to ensure we have the absolute latest value
    if (typeof window !== "undefined") {
      localStorage.setItem(opts.storageKey, String(currentWidthRef.current));
    }
  }

  return {
    width,
    handleProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      style: { touchAction: 'none' }
    },
  };
}
