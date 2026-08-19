import { FIBONACCI_LEVELS } from "@/lib/types/drawings"
import type { DrawingPoint } from "@/lib/types/drawings"

export interface FibonacciLevel {
  ratio: number
  label: string
  price: number
}

/**
 * Compute the 8 Fibonacci retracement level prices given two anchor points.
 * p1 is the high anchor (points[0]), p2 is the low anchor (points[1]).
 * Formula: levelPrice = highPrice - (highPrice - lowPrice) * ratio
 * At ratio=0 → p1.price (high), at ratio=1 → p2.price (low).
 */
export function computeFibonacciLevels(
  p1: DrawingPoint,
  p2: DrawingPoint,
): FibonacciLevel[] {
  const priceRange = p1.price - p2.price // positive when p1 > p2
  return FIBONACCI_LEVELS.map((level) => ({
    ratio: level.ratio,
    label: level.label,
    price: p1.price - priceRange * level.ratio,
  }))
}
