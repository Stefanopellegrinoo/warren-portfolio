"use client";

import { MousePointer2, Minus, Ruler, Trash2, TrendingUp, AlignJustify, Eraser, Lock, ArrowUpRight, Equal, BarChart2, MoveRight, MoveUpRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChartStore, type DrawingTool } from "@/lib/store/chart-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ToolDef {
  key: DrawingTool;
  icon: typeof MousePointer2;
  label: string;
  hint?: string;
}

const TOOLS: ToolDef[] = [
  { key: "cursor", icon: MousePointer2, label: "Cursor", hint: "Modo navegación" },
  {
    key: "hline",
    icon: Minus,
    label: "Línea horizontal",
    hint: "Click en el chart para marcar un precio",
  },
  {
    key: "horizontal_ray",
    icon: MoveRight,
    label: "Rayo horizontal",
    hint: "Click para iniciar un rayo horizontal a la derecha",
  },
  {
    key: "measure",
    icon: Ruler,
    label: "Regla / Medir",
    hint: "Click en dos puntos para medir Δ precio, %, barras y volumen",
  },
  {
    key: "trendline",
    icon: TrendingUp,
    label: "Línea de tendencia",
    hint: "Dos clicks para trazar una línea extendida",
  },
  {
    key: "fibonacci",
    icon: AlignJustify,
    label: "Fibonacci",
    hint: "Dos clicks para trazar niveles de retroceso Fibonacci",
  },
  {
    key: "ray",
    icon: ArrowUpRight,
    label: "Rayo",
    hint: "Dos clicks para trazar una semirrecta extendida",
  },
  {
    key: "channel",
    icon: Equal,
    label: "Canal paralelo",
    hint: "Tres clicks: línea base (2) + línea paralela (1)",
  },
  {
    key: "price_range",
    icon: BarChart2,
    label: "Rango de precio",
    hint: "Dos clicks para marcar un rango Δ$ y %",
  },
  {
    key: "arrow",
    icon: MoveUpRight,
    label: "Flecha",
    hint: "Dos clicks para trazar una flecha",
  },
  {
    key: "eraser",
    icon: Eraser,
    label: "Borrador",
    hint: "Click sobre un dibujo para eliminarlo",
  },
];

const LOCKED = [
  { label: "Texto" },
];

export function LeftSidebar() {
  const tool = useChartStore((s) => s.tool);
  const setTool = useChartStore((s) => s.setTool);
  const symbol = useChartStore((s) => s.symbol);
  const clearDrawings = useChartStore((s) => s.clearDrawings);

  function handleTrash() {
    if (!confirm("¿Borrar todos los dibujos de este ticker?")) return;
    fetch(`/api/drawings?ticker=${encodeURIComponent(symbol)}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok) throw new Error("delete failed");
        clearDrawings();
      })
      .catch(() => {
        toast.error("Error al borrar los dibujos");
      });
  }

  return (
    <aside className="hidden md:flex w-11 flex-col items-center gap-0.5 border-r border-tv-border bg-tv-panel py-1.5">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const active = tool === t.key;
        return (
          <Tooltip key={t.key}>
            <TooltipTrigger
              onClick={() => setTool(t.key)}
              aria-label={t.label}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-tv-panel-hover",
                active
                  ? "bg-tv-blue/15 text-tv-blue"
                  : "text-tv-text-muted hover:text-tv-text",
              )}
            >
              <Icon className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              <div className="font-medium">{t.label}</div>
              {t.hint && (
                <div className="mt-0.5 text-[10px] text-tv-text-muted">{t.hint}</div>
              )}
            </TooltipContent>
          </Tooltip>
        );
      })}

      <Tooltip>
        <TooltipTrigger
          onClick={handleTrash}
          aria-label="Borrar dibujos"
          className="flex h-8 w-8 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-red"
        >
          <Trash2 className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          <div className="font-medium">Borrar dibujos</div>
          <div className="mt-0.5 text-[10px] text-tv-text-muted">
            Limpia las líneas de este símbolo
          </div>
        </TooltipContent>
      </Tooltip>

      <div className="my-1 h-px w-6 bg-tv-border" />

      {LOCKED.map((t) => (
        <Tooltip key={t.label}>
          <TooltipTrigger
            disabled
            aria-label={t.label}
            className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded text-tv-text-dim opacity-40"
          >
            <Lock className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            <div className="font-medium">{t.label}</div>
            <div className="mt-0.5 text-[10px] text-tv-yellow">
              Próximamente · video 3
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
    </aside>
  );
}
