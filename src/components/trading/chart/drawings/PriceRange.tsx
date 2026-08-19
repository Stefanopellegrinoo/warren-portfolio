"use client";

import type { UTCTimestamp } from "lightweight-charts";
import type { ChartDrawing, DrawingStyle } from "@/lib/types/drawings";
import { DEFAULT_STYLE } from "@/lib/types/drawings";
import { formatPrice } from "@/lib/format";

interface PriceRangeProps {
  drawing: ChartDrawing;
  tool: string;
  containerWidth: number;
  timeToX: (t: UTCTimestamp) => number | null;
  priceToY: (p: number) => number | null;
  isPreview?: boolean;
  isSelected?: boolean;
}

export function PriceRange({
  drawing,
  tool,
  containerWidth,
  priceToY,
  timeToX,
  isPreview = false,
  isSelected = false,
}: PriceRangeProps) {
  const style: Required<DrawingStyle> = {
    ...DEFAULT_STYLE.price_range,
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

  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const width = maxX - minX;
  const height = maxY - minY;

  const priceDiff = p2.price - p1.price;
  const pctChange = p1.price === 0 ? 0 : (priceDiff / p1.price) * 100;
  const isUp = priceDiff >= 0;

  const lineOpacity = isPreview ? 0.6 : 1;

  return (
    <g opacity={lineOpacity}>
      <defs>
        <filter id="selection-glow">
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="white" floodOpacity="0.6" />
        </filter>
      </defs>

      <rect
        x={minX} y={minY} width={width} height={height}
        fill={style.color}
        fillOpacity={isSelected ? 0.3 : 0.2}
        stroke={style.color}
        strokeWidth={isSelected ? style.lineWidth + 1 : style.lineWidth}
        filter={isSelected ? "url(#selection-glow)" : undefined}
        pointerEvents="none"
      />

      <text
        x={minX + width / 2} y={minY + height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize={11}
        fontFamily="var(--font-sans), Inter, system-ui, sans-serif"
        pointerEvents="none"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
      >
        {formatPrice(priceDiff)} ({pctChange >= 0 ? "+" : ""}{pctChange.toFixed(2)}%)
      </text>

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
