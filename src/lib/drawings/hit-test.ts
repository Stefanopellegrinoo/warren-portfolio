/**
 * Pure geometry helpers for drawing hit-testing.
 * These are geometry fallbacks; the primary eraser hit-test uses SVG-native
 * pointer-events. These are used only if SVG-native proves insufficient.
 */

/**
 * Distance from point (px, py) to line segment from (ax, ay) to (bx, by).
 * Returns 0 if the point lies on the segment.
 */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Distance from point (px, py) to a horizontal line at y=ly,
 * bounded between x=lx1 and x=lx2.
 * If the point's x falls within [lx1, lx2] the distance is |py - ly|.
 * Outside the bounds it's the distance to the nearest endpoint.
 */
export function distanceToHorizontal(
  px: number,
  py: number,
  ly: number,
  lx1: number,
  lx2: number,
): number {
  const clampedX = Math.max(lx1, Math.min(lx2, px))
  return Math.hypot(px - clampedX, py - ly)
}

/**
 * Distance from point (px, py) to a semi-infinite ray that starts at (ax, ay)
 * and extends in the direction of (bx, by). The ray has no upper bound on t
 * (semi-infinite past b), but is clamped at t=0 so the region behind the
 * origin is handled as point-to-origin distance.
 */
export function distanceToRay(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  if (t < 0) t = 0 // before start point — use start-point distance
  // No upper bound on t (semi-infinite)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Distance from point (px, py) to a horizontal ray that starts at (ax, ay)
 * and extends infinitely to the right.
 */
export function distanceToHorizontalRay(
  px: number,
  py: number,
  ax: number,
  ay: number,
): number {
  if (px < ax) return Math.hypot(px - ax, py - ay)
  return Math.abs(py - ay)
}

/**
 * Returns the perpendicular offset vector that maps the main-line (p1→p2) to
 * the parallel line passing through p3 (all in screen-space pixels).
 * The returned {dx, dy} should be added to every point on the main line.
 */
export function perpendicularOffset(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
): { dx: number; dy: number } {
  const lineDx = p2x - p1x
  const lineDy = p2y - p1y
  const len = Math.hypot(lineDx, lineDy)
  if (len === 0) return { dx: 0, dy: 0 }
  // Perpendicular unit vector (rotate 90° CCW): (-lineDy/len, lineDx/len)
  const perpX = -lineDy / len
  const perpY = lineDx / len
  // Project (p3 - p1) onto the perpendicular
  const vx = p3x - p1x
  const vy = p3y - p1y
  const projDist = vx * perpX + vy * perpY
  return { dx: perpX * projDist, dy: perpY * projDist }
}

/**
 * Distance from point (px, py) to the perimeter of an axis-aligned rectangle
 * defined by two opposite corners (x1,y1) and (x2,y2).
 */
export function distanceToRectPerimeter(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  const top = Math.min(y1, y2)
  const bottom = Math.max(y1, y2)
  const d1 = distanceToSegment(px, py, left, top, right, top)      // top edge
  const d2 = distanceToSegment(px, py, left, bottom, right, bottom) // bottom edge
  const d3 = distanceToSegment(px, py, left, top, left, bottom)    // left edge
  const d4 = distanceToSegment(px, py, right, top, right, bottom)  // right edge
  return Math.min(d1, d2, d3, d4)
}

/** Returns true when cursor is within `threshold` px of the hline at lineY */
export function isHitHLine(
  py: number,
  lineY: number,
  threshold = 8,
): boolean {
  return Math.abs(py - lineY) < threshold
}

/**
 * Returns true when cursor is within `threshold` px of the horizontal ray
 * starting at (ax, ay) and extending right.
 */
export function isHitHorizontalRay(
  px: number,
  py: number,
  ax: number,
  ay: number,
  threshold = 8,
): boolean {
  return distanceToHorizontalRay(px, py, ax, ay) < threshold
}

/**
 * Returns true when cursor is within `threshold` px of the ray from (ax,ay)
 * in direction (bx,by). Points behind the origin (t < 0) do NOT hit.
 */
export function isHitRay(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  threshold = 8,
): boolean {
  return distanceToRay(px, py, ax, ay, bx, by) < threshold
}

/**
 * Returns true when cursor is within `threshold` px of either line of a
 * parallel channel. Both lines are represented as arbitrary segments here;
 * the caller should extend them to canvas edges before calling.
 */
export function isHitChannel(
  px: number,
  py: number,
  // main line segment
  mx1: number,
  my1: number,
  mx2: number,
  my2: number,
  // parallel line segment
  ox1: number,
  oy1: number,
  ox2: number,
  oy2: number,
  threshold = 8,
): boolean {
  return (
    distanceToSegment(px, py, mx1, my1, mx2, my2) < threshold ||
    distanceToSegment(px, py, ox1, oy1, ox2, oy2) < threshold
  )
}

/**
 * Returns true when cursor is within `threshold` px of any side of the
 * axis-aligned rectangle defined by two opposite corners.
 */
export function isHitPriceRange(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  threshold = 8,
): boolean {
  return distanceToRectPerimeter(px, py, x1, y1, x2, y2) < threshold
}
