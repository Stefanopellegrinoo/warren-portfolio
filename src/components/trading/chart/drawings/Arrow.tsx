"use client";

import type { UTCTimestamp } from "lightweight-charts";
import type { ChartDrawing, DrawingStyle } from "@/lib/types/drawings";
import { DEFAULT_STYLE } from "@/lib/types/drawings";

interface ArrowProps {
  drawing: ChartDrawing;
  tool: string;
  containerWidth: number;
  timeToX: (t: UTCTimestamp) => number | null;
  priceToY: (p: number) => number | null;
  isPreview?: boolean;
  isSelected?: boolean;
}

export function Arrow({
  drawing,
  tool,
  containerWidth,
  priceToY,
  timeToX,
  isPreview = false,
  isSelected = false,
}: ArrowProps) {
  const style: Required<DrawingStyle> = {
    ...DEFAULT_STYLE.arrow,
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

  const lineOpacity = isPreview ? 0.6 : 1;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLength = 10;

  return (
    <g opacity={lineOpacity}>
      <defs>
        <filter id="selection-glow">
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="white" floodOpacity="0.6" />
        </filter>
      </defs>

      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={style.color}
        strokeWidth={isSelected ? style.lineWidth + 1 : style.lineWidth}
        filter={isSelected ? "url(#selection-glow)" : undefined}
        pointerEvents="none"
      />
      <path
        d={`M ${x2} ${y2} L ${x2 - headLength * Math.cos(angle - Math.PI / 6)} ${y2 - headLength * Math.sin(angle - Math.PI / 6)} M ${x2} ${y2} L ${x2 - headLength * Math.cos(angle + Math.PI / 6)} ${y2 - headLength * Math.sin(angle + Math.PI / 6)}`}
        stroke={style.color}
        strokeWidth={isSelected ? style.lineWidth + 1 : style.lineWidth}
        fill="none"
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
