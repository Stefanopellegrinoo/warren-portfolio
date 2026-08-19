"use client";

import { useId } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import type { ChartDrawing, DrawingPoint, InProgressDrawing } from "@/lib/types/drawings";
import { Trendline } from "./drawings/Trendline";
import { FibonacciRetracement } from "./drawings/FibonacciRetracement";
import { HLine } from "./drawings/HLine";
import { Ray } from "./drawings/Ray";
import { ParallelChannel } from "./drawings/ParallelChannel";
import { PriceRange } from "./drawings/PriceRange";
import { HorizontalRay } from "./drawings/HorizontalRay";
import { Arrow } from "./drawings/Arrow";

interface DrawingOverlayProps {
  drawings: ChartDrawing[];
  inProgressDrawing: InProgressDrawing | null;
  previewPoint2: DrawingPoint | null;
  tool: string;
  renderTick: number;
  timeToX: (t: UTCTimestamp) => number | null;
  priceToY: (p: number) => number | null;
  containerWidth: number;
  containerHeight: number;
  onDrag: (id: string, pointIndex: number, newPoint: DrawingPoint) => void;
  onErase: (id: string) => void;
  xToTime: (x: number) => UTCTimestamp | null;
  yToPrice: (y: number) => number | null;
  selectedId: string | null;
}

export function DrawingOverlay({
  drawings,
  inProgressDrawing,
  previewPoint2,
  tool,
  renderTick,
  timeToX,
  priceToY,
  containerWidth,
  containerHeight,
  onDrag,
  onErase,
  xToTime,
  yToPrice,
  selectedId,
}: DrawingOverlayProps) {
  const clipId = useId().replace(/:/g, "");
  // renderTick is intentionally read to force re-render on pan/zoom
  void renderTick;

  // Build a synthetic preview drawing from in-progress state + current cursor position.
  let previewDrawing: ChartDrawing | null = null;

  if (inProgressDrawing && previewPoint2 && inProgressDrawing.type !== "hline" && inProgressDrawing.type !== "horizontal_ray") {
    const { type, points } = inProgressDrawing;

    if (type === "channel") {
      if (points.length === 1) {
        previewDrawing = {
          id: "__preview__",
          userId: "",
          ticker: "",
          type,
          points: [points[0], previewPoint2],
          style: {},
          createdAt: "",
          updatedAt: "",
        };
      } else if (points.length === 2) {
        previewDrawing = {
          id: "__preview__",
          userId: "",
          ticker: "",
          type,
          points: [points[0], points[1], previewPoint2],
          style: {},
          createdAt: "",
          updatedAt: "",
        };
      }
    } else if (points.length >= 1) {
      previewDrawing = {
        id: "__preview__",
        userId: "",
        ticker: "",
        type,
        points: [points[0], previewPoint2],
        style: {},
        createdAt: "",
        updatedAt: "",
      };
    }
  }

  const sharedProps = {
    tool,
    containerWidth,
    containerHeight,
    timeToX,
    priceToY,
    xToTime,
    yToPrice,
    onDrag,
    onErase,
  };

  function renderDrawing(d: ChartDrawing, isPreview = false) {
    const isSelected = d.id === selectedId;
    const props = { ...sharedProps, isPreview, isSelected };
    switch (d.type) {
      case "trendline":
        return <Trendline key={d.id} drawing={d} {...props} />;
      case "fibonacci":
        return <FibonacciRetracement key={d.id} drawing={d} {...props} />;
      case "hline":
        return <HLine key={d.id} drawing={d} {...props} />;
      case "ray":
        return <Ray key={d.id} drawing={d} {...props} />;
      case "horizontal_ray":
        return <HorizontalRay key={d.id} drawing={d} {...props} />;
      case "channel":
        return <ParallelChannel key={d.id} drawing={d} {...props} />;
      case "price_range":
        return <PriceRange key={d.id} drawing={d} {...props} />;
      case "arrow":
        return <Arrow key={d.id} drawing={d} {...props} />;
      default:
        return null;
    }
  }

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20"
      width={containerWidth}
      height={containerHeight}
      viewBox={`0 0 ${containerWidth} ${containerHeight}`}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={containerWidth} height={containerHeight} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {drawings.map((d) => renderDrawing(d))}
        {previewDrawing && renderDrawing(previewDrawing, true)}
      </g>
    </svg>
  );
}
