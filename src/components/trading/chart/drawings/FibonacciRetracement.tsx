"use client";

import type { UTCTimestamp } from "lightweight-charts";
import type { ChartDrawing, DrawingPoint, DrawingStyle } from "@/lib/types/drawings";
import { DEFAULT_STYLE } from "@/lib/types/drawings";
import { computeFibonacciLevels } from "@/lib/drawings/fibonacci";

interface FibonacciRetracementProps {
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

export function FibonacciRetracement({
  drawing,
  tool,
  containerWidth,
  priceToY,
  timeToX,
  isPreview = false,
  isSelected = false,
}: FibonacciRetracementProps) {
  const style: Required<DrawingStyle> = {
    ...DEFAULT_STYLE.fibonacci,
    ...drawing.style,
  };

  const p1 = drawing.points[0];
  const p2 = drawing.points[1];
  if (!p1 || !p2) return null;

  const x1Raw = timeToX(p1.time as UTCTimestamp);
  const x2Raw = timeToX(p2.time as UTCTimestamp);
  const y1Raw = priceToY(p1.price);
  const y2Raw = priceToY(p2.price);

  if (x1Raw === null || x2Raw === null || y1Raw === null || y2Raw === null) return null;

  const levels = computeFibonacciLevels(p1, p2);
  const lineOpacity = isPreview ? 0.6 : 1;

  const dashArray =
    style.lineDash && style.lineDash.length > 0
      ? style.lineDash.join(",")
      : isPreview
      ? "6,4"
      : undefined;

  return (
    <g opacity={lineOpacity}>
      <defs>
        <filter id="selection-glow">
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="white" floodOpacity="0.6" />
        </filter>
      </defs>

      {levels.map((level) => {
        const y = priceToY(level.price);
        if (y === null) return null;

        return (
          <g key={level.label}>
            <line
              x1={0} y1={y} x2={containerWidth} y2={y}
              stroke={style.color}
              strokeWidth={isSelected ? style.lineWidth + 1 : style.lineWidth}
              strokeDasharray={dashArray}
              filter={isSelected ? "url(#selection-glow)" : undefined}
              pointerEvents="none"
              opacity={level.ratio === 0 || level.ratio === 1 ? 1 : 0.8}
            />
            <text
              x={containerWidth - 4} y={y - 3}
              textAnchor="end"
              fill={style.color}
              fontSize={10}
              fontFamily="var(--font-sans), Inter, system-ui, sans-serif"
              pointerEvents="none"
              opacity={0.9}
            >
              {level.label} {level.price.toFixed(2)}
            </text>
          </g>
        );
      })}

      {/* Handles */}
      {!isPreview && (isSelected || tool === "cursor") && (
        <>
          <circle cx={x1Raw} cy={y1Raw} r={5} fill={style.color} stroke="white" strokeWidth={1.5} pointerEvents="none" />
          <circle cx={x2Raw} cy={y2Raw} r={5} fill={style.color} stroke="white" strokeWidth={1.5} pointerEvents="none" />
        </>
      )}
    </g>
  );
}
