"use client";

import type { UTCTimestamp } from "lightweight-charts";
import type { ChartDrawing, DrawingPoint, DrawingStyle } from "@/lib/types/drawings";
import { DEFAULT_STYLE } from "@/lib/types/drawings";

interface TrendlineProps {
  drawing: ChartDrawing;
  tool: string;
  containerWidth: number;
  containerHeight: number;
  timeToX: (t: UTCTimestamp) => number | null;
  priceToY: (p: number) => number | null;
  xToTime: (x: number) => UTCTimestamp | null;
  yToPrice: (y: number) => number | null;
  onDrag: (id: string, pointIndex: 0 | 1, newPoint: DrawingPoint) => void;
  onErase: (id: string) => void;
  isPreview?: boolean;
  isSelected?: boolean;
}

export function Trendline({
  drawing,
  tool,
  containerWidth,
  priceToY,
  timeToX,
  isPreview = false,
  isSelected = false,
}: TrendlineProps) {
  const style: Required<DrawingStyle> = {
    ...DEFAULT_STYLE.trendline,
    ...drawing.style,
  };

  const p1 = drawing.points[0];
  const p2 = drawing.points[1];
  if (!p1 || !p2) return null;

  const x1Raw = timeToX(p1.time as UTCTimestamp);
  const y1Raw = priceToY(p1.price);
  const x2Raw = timeToX(p2.time as UTCTimestamp);
  const y2Raw = priceToY(p2.price);

  if (x1Raw === null || y1Raw === null || x2Raw === null || y2Raw === null) {
    return null;
  }

  // Extend line to full container width
  let lineX1: number;
  let lineY1: number;
  let lineX2: number;
  let lineY2: number;

  if (Math.abs(x2Raw - x1Raw) < 0.001) {
    lineX1 = x1Raw;
    lineY1 = 0;
    lineX2 = x1Raw;
    lineY2 = 2000; // Large enough vertical
  } else {
    const slope = (y2Raw - y1Raw) / (x2Raw - x1Raw);
    const b = y1Raw - slope * x1Raw;
    lineX1 = 0;
    lineY1 = slope * 0 + b;
    lineX2 = containerWidth;
    lineY2 = slope * containerWidth + b;
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

      {/* The visible line */}
      <line
        x1={lineX1}
        y1={lineY1}
        x2={lineX2}
        y2={lineY2}
        stroke={style.color}
        strokeWidth={isSelected ? style.lineWidth + 1 : style.lineWidth}
        strokeDasharray={dashArray}
        filter={isSelected ? "url(#selection-glow)" : undefined}
        pointerEvents="none"
      />

      {/* Handles */}
      {!isPreview && (isSelected || tool === "cursor") && (
        <>
          <circle
            cx={x1Raw}
            cy={y1Raw}
            r={5}
            fill={style.color}
            stroke="white"
            strokeWidth={1.5}
            pointerEvents="none"
          />
          <circle
            cx={x2Raw}
            cy={y2Raw}
            r={5}
            fill={style.color}
            stroke="white"
            strokeWidth={1.5}
            pointerEvents="none"
          />
        </>
      )}
    </g>
  );
}
