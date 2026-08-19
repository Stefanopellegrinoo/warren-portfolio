"use client";

import type { UTCTimestamp } from "lightweight-charts";
import type { ChartDrawing, DrawingStyle } from "@/lib/types/drawings";
import { DEFAULT_STYLE } from "@/lib/types/drawings";

interface RayProps {
  drawing: ChartDrawing;
  tool: string;
  containerWidth: number;
  timeToX: (t: UTCTimestamp) => number | null;
  priceToY: (p: number) => number | null;
  isPreview?: boolean;
  isSelected?: boolean;
}

export function Ray({
  drawing,
  tool,
  containerWidth,
  priceToY,
  timeToX,
  isPreview = false,
  isSelected = false,
}: RayProps) {
  const style: Required<DrawingStyle> = {
    ...DEFAULT_STYLE.ray,
    ...drawing.style,
  };

  const p1 = drawing.points[0];
  const p2 = drawing.points[1];
  if (!p1 || !p2) return null;

  const x1 = timeToX(p1.time as UTCTimestamp);
  const y1 = priceToY(p1.price);
  const x2 = timeToX(p2.time as UTCTimestamp);
  const y2 = priceToY(p2.price);

  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

  // Extend ray to the right edge
  let lineX2: number;
  let lineY2: number;

  if (Math.abs(x2 - x1) < 0.001) {
    lineX2 = x1;
    lineY2 = y2 > y1 ? 2000 : 0;
  } else {
    const slope = (y2 - y1) / (x2 - x1);
    const b = y1 - slope * x1;
    lineX2 = x2 > x1 ? containerWidth : 0;
    lineY2 = slope * lineX2 + b;
  }

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
        x1={x1} y1={y1} x2={lineX2} y2={lineY2}
        stroke={style.color}
        strokeWidth={isSelected ? style.lineWidth + 1 : style.lineWidth}
        strokeDasharray={dashArray}
        filter={isSelected ? "url(#selection-glow)" : undefined}
        pointerEvents="none"
      />

      {/* Handles */}
      {!isPreview && (isSelected || tool === "cursor") && (
        <>
          <circle cx={x1} cy={y1} r={5} fill={style.color} stroke="white" strokeWidth={1.5} pointerEvents="none" />
          <circle cx={x2} cy={y2} r={5} fill={style.color} stroke="white" strokeWidth={1.5} pointerEvents="none" />
        </>
      )}
    </g>
  );
}
