"use client";

import type { UTCTimestamp } from "lightweight-charts";
import type { ChartDrawing, DrawingStyle } from "@/lib/types/drawings";
import { DEFAULT_STYLE } from "@/lib/types/drawings";
import { perpendicularOffset } from "@/lib/drawings/hit-test";

interface ParallelChannelProps {
  drawing: ChartDrawing;
  tool: string;
  containerWidth: number;
  containerHeight: number;
  timeToX: (t: UTCTimestamp) => number | null;
  priceToY: (p: number) => number | null;
  isPreview?: boolean;
  isSelected?: boolean;
}

/** Extends a line through (ax, ay) and (bx, by) to the right edge of the canvas */
function extendLineRight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  canvasWidth: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const xStart = Math.min(ax, bx);
  const xEnd = canvasWidth;

  if (Math.abs(bx - ax) < 0.001) {
    return { x1: ax, y1: 0, x2: ax, y2: 2000 }; 
  }

  const slope = (by - ay) / (bx - ax);
  const b = ay - slope * ax;

  return {
    x1: xStart,
    y1: slope * xStart + b,
    x2: xEnd,
    y2: slope * xEnd + b,
  };
}

export function ParallelChannel({
  drawing,
  tool,
  containerWidth,
  priceToY,
  timeToX,
  isPreview = false,
  isSelected = false,
}: ParallelChannelProps) {
  const style: Required<DrawingStyle> = {
    ...DEFAULT_STYLE.channel,
    ...drawing.style,
  };

  const p1 = drawing.points[0];
  const p2 = drawing.points[1];
  const p3 = drawing.points[2];
  if (!p1 || !p2) return null;

  const x1 = timeToX(p1.time as UTCTimestamp);
  const y1 = priceToY(p1.price);
  const x2 = timeToX(p2.time as UTCTimestamp);
  const y2 = priceToY(p2.price);

  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

  const main = extendLineRight(x1, y1, x2, y2, containerWidth);

  const dashArray =
    isPreview || (style.lineDash && style.lineDash.length > 0)
      ? style.lineDash && style.lineDash.length > 0
        ? style.lineDash.join(",")
        : "6,4"
      : undefined;

  const lineOpacity = isPreview ? 0.6 : 1;

  if (!p3) {
    return (
      <g opacity={lineOpacity}>
        <line
          x1={main.x1} y1={main.y1} x2={main.x2} y2={main.y2}
          stroke={style.color}
          strokeWidth={style.lineWidth}
          strokeDasharray={dashArray}
          pointerEvents="none"
        />
      </g>
    );
  }

  const x3 = timeToX(p3.time as UTCTimestamp);
  const y3 = priceToY(p3.price);
  if (x3 === null || y3 === null) return null;

  const offset = perpendicularOffset(x1, y1, x2, y2, x3, y3);
  const para = extendLineRight(x1 + offset.dx, y1 + offset.dy, x2 + offset.dx, y2 + offset.dy, containerWidth);
  const mid = extendLineRight(x1 + offset.dx/2, y1 + offset.dy/2, x2 + offset.dx/2, y2 + offset.dy/2, containerWidth);
  const proj = extendLineRight(x1 - offset.dx, y1 - offset.dy, x2 - offset.dx, y2 - offset.dy, containerWidth);

  const fillPoints = [
    `${main.x1},${main.y1}`,
    `${main.x2},${main.y2}`,
    `${para.x2},${para.y2}`,
    `${para.x1},${para.y1}`,
  ].join(" ");

  return (
    <g opacity={lineOpacity}>
      <defs>
        <filter id="selection-glow">
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="white" floodOpacity="0.6" />
        </filter>
      </defs>

      <polygon points={fillPoints} fill={style.color} fillOpacity={isSelected ? 0.25 : 0.15} stroke="none" pointerEvents="none" />

      {/* Resistance, Support, Midline, Projection */}
      {[main, para, mid, proj].map((line, i) => (
        <line
          key={i}
          x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
          stroke={style.color}
          strokeWidth={isSelected && i < 2 ? style.lineWidth + 1 : style.lineWidth}
          strokeDasharray={i === 2 ? "5,5" : i === 3 ? "2,4" : dashArray}
          opacity={i === 3 ? 0.3 : i === 2 ? 0.6 : 1}
          filter={isSelected && i < 2 ? "url(#selection-glow)" : undefined}
          pointerEvents="none"
        />
      ))}

      {/* Handles */}
      {!isPreview && (isSelected || tool === "cursor") && (
        <>
          <circle cx={x1} cy={y1} r={5} fill={style.color} stroke="white" strokeWidth={1.5} pointerEvents="none" />
          <circle cx={x2} cy={y2} r={5} fill={style.color} stroke="white" strokeWidth={1.5} pointerEvents="none" />
          <circle cx={x3} cy={y3} r={5} fill={style.color} stroke="white" strokeWidth={1.5} pointerEvents="none" />
        </>
      )}
    </g>
  );
}
