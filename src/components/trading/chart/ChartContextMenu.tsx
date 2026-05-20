"use client";

import { useEffect, useRef } from "react";

interface Props {
  x: number;
  y: number;
  price: number;
  onNewAlert: (price: number) => void;
  onClose: () => void;
}

const MENU_WIDTH = 220;
const MENU_HEIGHT = 90;

export function ChartContextMenu({ x, y, price, onNewAlert, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Clamp position to viewport bounds
  const left = x + MENU_WIDTH > window.innerWidth ? x - MENU_WIDTH : x;
  const top = y + MENU_HEIGHT > window.innerHeight ? y - MENU_HEIGHT : y;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{ left, top }}
      className="fixed z-50 bg-[#0d1829]/90 backdrop-blur border border-white/[0.06] rounded-lg shadow-xl overflow-hidden"
    >
      <button
        className="w-full text-left px-4 py-2.5 text-xs font-mono hover:bg-white/[0.04] flex items-center gap-2 cursor-pointer text-white/80"
        onClick={() => {
          onNewAlert(price);
          onClose();
        }}
      >
        <span>🔔</span>
        <span>Nueva alerta aquí</span>
        <span className="ml-auto text-slate-500">{price.toFixed(2)}</span>
      </button>
      <button
        className="w-full text-left px-4 py-2.5 text-xs font-mono flex items-center gap-2 cursor-not-allowed text-slate-500"
        disabled
      >
        <span>✏️</span>
        <span>Línea horizontal</span>
      </button>
    </div>
  );
}
