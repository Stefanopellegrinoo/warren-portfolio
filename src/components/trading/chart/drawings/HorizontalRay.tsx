"use client";

import type { UTCTimestamp } from "lightweight-charts";
import type { ChartDrawing, DrawingStyle } from "@/lib/types/drawings";
import { DEFAULT_STYLE } from "@/lib/types/drawings";

interface HorizontalRayProps {
  drawing: ChartDrawing;
  tool: string;
  containerWidth: number;
  timeToX: (t: UTCTimestamp) => number | null;
  priceToY: (p: number) => number | null;
  isPreview?: boolean;
  isSelected?: boolean;
}

export function HorizontalRay({
  drawing,
  tool,
  containerWidth,
  priceToY,
  timeToX,
  isPreview = false,
  isSelected = false,
}: HorizontalRayProps) {
  const style: Required<DrawingStyle> = {
    ...DEFAULT_STYLE.horizontal_ray,
    ...drawing.style,
  };

  const p1 = drawing.points[0];
  if (!p1) return null;

  const x = timeToX(p1.time as UTCTimestamp);
  const y = priceToY(p1.price);
  if (x === null || y === null) return null;

  const dashArray =
    style.lineDash && style.lineDash.length > 0
      ? style.lineDash.join(",")
      : isPreview
      ? "6,4"
      : undefined;

  const lineOpacity = isPreview ? 0.6 : 1;

  return (
    <g opacity={lineOpacity}>
      <defs>
        <filter id="selection-glow">
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="white" floodOpacity="0.6" />
        </filter>
      </defs>

      <line
        x1={x} y1={y} x2={containerWidth} y2={y}
        stroke={style.color}
        strokeWidth={isSelected ? style.lineWidth + 1 : style.lineWidth}
        strokeDasharray={dashArray}
        filter={isSelected ? "url(#selection-glow)" : undefined}
        pointerEvents="none"
      />

      {/* Handles */}
      {!isPreview && (isSelected || tool === "cursor") && (
        <circle cx={x} cy={y} r={5} fill={style.color} stroke="white" strokeWidth={1.5} pointerEvents="none" />
      )}
    </g>
  );
}
