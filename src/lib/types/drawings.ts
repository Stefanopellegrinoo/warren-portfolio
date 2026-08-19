import type { UTCTimestamp } from "lightweight-charts"

export type DrawingType =
  | "trendline"
  | "fibonacci"
  | "hline"
  | "ray"
  | "channel"
  | "price_range"
  | "horizontal_ray"
  | "arrow"

export interface DrawingPoint {
  time: UTCTimestamp // seconds since epoch (lightweight-charts convention)
  price: number
}

export interface DrawingStyle {
  color?: string // CSS color; default per type
  lineWidth?: number // px; default 1.5
  lineDash?: number[] // SVG dash array; default solid
}

export interface ChartDrawing {
  id: string // UUID from DB
  userId: string // RLS scope
  ticker: string // upper-case symbol
  type: DrawingType
  points: DrawingPoint[] // 1–3 points depending on type
  style: DrawingStyle
  label?: string // optional user annotation
  createdAt: string // ISO
  updatedAt: string // ISO
}

export interface InProgressDrawing {
  type: DrawingType
  points: DrawingPoint[] // length grows 0→target as user clicks
}

/** How many clicks each tool needs before committing a drawing */
export const TARGET_CLICKS: Record<DrawingType, 1 | 2 | 3> = {
  hline: 1,
  horizontal_ray: 1,
  ray: 2,
  price_range: 2,
  trendline: 2,
  fibonacci: 2,
  arrow: 2,
  channel: 3,
}

export const FIBONACCI_LEVELS = [
  { ratio: 0, label: "0%" },
  { ratio: 0.236, label: "23.6%" },
  { ratio: 0.382, label: "38.2%" },
  { ratio: 0.5, label: "50%" },
  { ratio: 0.618, label: "61.8%" },
  { ratio: 0.786, label: "78.6%" },
  { ratio: 1, label: "100%" },
  { ratio: 1.272, label: "-27.2%" }, // extension below low anchor
] as const

export const DEFAULT_STYLE: Record<DrawingType, Required<DrawingStyle>> = {
  trendline:      { color: "#2196f3", lineWidth: 1.5, lineDash: [] },
  fibonacci:      { color: "#9c27b0", lineWidth: 1,   lineDash: [] },
  hline:          { color: "#ffb300", lineWidth: 1.5, lineDash: [] },
  horizontal_ray: { color: "#ffb300", lineWidth: 1.5, lineDash: [] },
  ray:            { color: "#26a69a", lineWidth: 1.5, lineDash: [] },
  channel:        { color: "#42a5f5", lineWidth: 1.5, lineDash: [] },
  price_range:    { color: "#66bb6a", lineWidth: 1.5, lineDash: [4, 4] },
  arrow:          { color: "#f44336", lineWidth: 2,   lineDash: [] },
}
