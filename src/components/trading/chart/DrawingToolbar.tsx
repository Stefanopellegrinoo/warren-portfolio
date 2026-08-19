"use client";

import { Trash2, Type, Move, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const COLORS = [
  "#2196F3", // Blue
  "#ef5350", // Red
  "#26a69a", // Green
  "#ffb74d", // Orange
  "#ab47bc", // Purple
  "#d1d4dc", // Gray
  "#ffffff", // White
];

const THICKNESSES = [1, 2, 3, 4];

const STYLES = [
  { label: "Sólida", value: [], icon: "━" },
  { label: "Discontinua", value: [6, 4], icon: "╌" },
  { label: "Punteada", value: [2, 4], icon: "‥" },
];

interface DrawingToolbarProps {
  x: number;
  y: number;
  style: {
    color: string;
    lineWidth: number;
    lineDash?: number[];
  };
  onStyleChange: (newStyle: any) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function DrawingToolbar({
  x,
  y,
  style,
  onStyleChange,
  onDelete,
  onClose,
}: DrawingToolbarProps) {
  return (
    <div
      className="absolute z-[100] flex items-center gap-1 rounded-md border border-tv-border bg-tv-bg p-1 shadow-xl shadow-black/50 backdrop-blur-md transition-all animate-in fade-in zoom-in duration-150"
      style={{ left: Math.max(10, x - 100), top: Math.max(10, y - 60) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Color Picker */}
      <div className="flex items-center gap-1 border-r border-tv-border pr-1 mr-1">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onStyleChange({ ...style, color: c })}
            className={cn(
              "h-5 w-5 rounded-full border border-black/20 transition-transform hover:scale-110",
              style.color === c && "ring-2 ring-tv-text"
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      {/* Thickness Selector */}
      <div className="flex items-center gap-1 border-r border-tv-border pr-1 mr-1">
        {THICKNESSES.map((t) => (
          <button
            key={t}
            onClick={() => onStyleChange({ ...style, lineWidth: t })}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold transition-colors hover:bg-tv-panel-hover",
              style.lineWidth === t ? "bg-tv-blue text-white" : "text-tv-text-muted"
            )}
          >
            {t}px
          </button>
        ))}
      </div>

      {/* Line Style Selector */}
      <div className="flex items-center gap-1 border-r border-tv-border pr-1 mr-1">
        {STYLES.map((s) => (
          <button
            key={s.label}
            onClick={() => onStyleChange({ ...style, lineDash: s.value })}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded text-sm transition-colors hover:bg-tv-panel-hover",
              JSON.stringify(style.lineDash || []) === JSON.stringify(s.value)
                ? "bg-tv-blue text-white"
                : "text-tv-text-muted"
            )}
            title={s.label}
          >
            {s.icon}
          </button>
        ))}
      </div>
      
      <button
        onClick={onDelete}
        className="rounded p-1.5 text-tv-text-muted hover:bg-tv-red/10 hover:text-tv-red transition-colors"
        title="Eliminar"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <div className="w-px h-4 bg-tv-border mx-1" />
      
      <button
        onClick={onClose}
        className="px-2 py-1 text-[10px] font-bold text-tv-blue hover:bg-tv-blue/10 rounded transition-colors"
      >
        LISTO
      </button>
    </div>
  );
}
