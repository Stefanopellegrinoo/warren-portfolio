import { describe, it, expect } from "vitest";
import {
  distanceToRay,
  perpendicularOffset,
  distanceToRectPerimeter,
  distanceToSegment,
  isHitHLine,
  isHitRay,
  isHitChannel,
  isHitPriceRange,
} from "../hit-test";

// ─────────────────────────────────────────────
// distanceToRay
// ─────────────────────────────────────────────
describe("distanceToRay", () => {
  it("returns 0 for a point on the ray segment between a and b", () => {
    // Ray from (0,0) toward (10,0) — point at (5, 0) lies exactly on it
    expect(distanceToRay(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  it("returns 0 for a point past b (semi-infinite extension)", () => {
    // Point at (20, 0) — past b=(10,0) but still on the ray
    expect(distanceToRay(20, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  it("returns distance from origin when point is behind start (t < 0)", () => {
    // Point at (-5, 0) — behind origin; clamped to t=0, distance = 5
    expect(distanceToRay(-5, 0, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it("returns perpendicular distance for a point off the ray line", () => {
    // Ray from (0,0) toward (10,0). Point at (5, 3) — perp distance = 3
    expect(distanceToRay(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it("handles degenerate ray (a === b) — returns hypot to origin", () => {
    expect(distanceToRay(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });

  it("leftward ray: point past b to the left still hits", () => {
    // Ray from (10,0) toward (0,0). Point at (-5, 0) — past b on the left
    expect(distanceToRay(-5, 0, 10, 0, 0, 0)).toBeCloseTo(0);
  });

  it("leftward ray: point to the right of origin does NOT hit (behind start)", () => {
    // Ray from (10,0) toward (0,0). Point at (15, 0) — behind origin
    // t = ((15-10)*(0-10) + ...) / 100 = (5*(-10)) / 100 = -0.5 → clamped to 0
    // distance = hypot(15-10, 0) = 5
    expect(distanceToRay(15, 0, 10, 0, 0, 0)).toBeCloseTo(5);
  });
});

// ─────────────────────────────────────────────
// perpendicularOffset
// ─────────────────────────────────────────────
describe("perpendicularOffset", () => {
  it("returns zero offset when p3 is on the main line", () => {
    // Main line: (0,0)→(10,0) horizontal. p3 = (5, 0) on the line.
    const { dx, dy } = perpendicularOffset(0, 0, 10, 0, 5, 0);
    expect(dx).toBeCloseTo(0);
    expect(dy).toBeCloseTo(0);
  });

  it("returns vertical offset for a horizontal main line", () => {
    // Main line: (0,0)→(10,0). p3 = (5, 5) — 5px above (in screen y-down).
    // Perp of horizontal is vertical, so offset should be (0, 5).
    const { dx, dy } = perpendicularOffset(0, 0, 10, 0, 5, 5);
    expect(dx).toBeCloseTo(0);
    expect(dy).toBeCloseTo(5);
  });

  it("returns horizontal offset for a vertical main line", () => {
    // Main line: (0,0)→(0,10). p3 = (5, 5) — 5px to the right.
    const { dx, dy } = perpendicularOffset(0, 0, 0, 10, 5, 5);
    expect(dx).toBeCloseTo(5);
    expect(dy).toBeCloseTo(0);
  });

  it("handles degenerate (zero-length) main line", () => {
    const { dx, dy } = perpendicularOffset(5, 5, 5, 5, 10, 10);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });

  it("correctly computes offset magnitude for a diagonal line", () => {
    // Main line from (0,0) to (10,10) — 45-degree line.
    // p3 = (0, 10): perpendicular distance = |10 * cos45 - 0 * cos45 + ...| = 5*sqrt(2)
    const { dx, dy } = perpendicularOffset(0, 0, 10, 10, 0, 10);
    const magnitude = Math.hypot(dx, dy);
    expect(magnitude).toBeCloseTo(5 * Math.SQRT2);
  });

  it("produces same offset when p3 is translated along the main line", () => {
    // Main line: horizontal (0,0)→(10,0). p3a=(2,3), p3b=(8,3) — same height.
    const r1 = perpendicularOffset(0, 0, 10, 0, 2, 3);
    const r2 = perpendicularOffset(0, 0, 10, 0, 8, 3);
    expect(r1.dy).toBeCloseTo(r2.dy);
    expect(r1.dx).toBeCloseTo(r2.dx);
  });
});

// ─────────────────────────────────────────────
// distanceToRectPerimeter
// ─────────────────────────────────────────────
describe("distanceToRectPerimeter", () => {
  // Rectangle: (0,0) to (100,50)
  it("returns 0 for a point on the top edge", () => {
    expect(distanceToRectPerimeter(50, 0, 0, 0, 100, 50)).toBeCloseTo(0);
  });

  it("returns 0 for a point on the left edge", () => {
    expect(distanceToRectPerimeter(0, 25, 0, 0, 100, 50)).toBeCloseTo(0);
  });

  it("returns distance to nearest side for an interior point", () => {
    // Point at (50, 5) — nearest to top edge (y=0), distance = 5
    expect(distanceToRectPerimeter(50, 5, 0, 0, 100, 50)).toBeCloseTo(5);
  });

  it("returns distance for a point outside the rectangle", () => {
    // Point at (50, -10) — 10px above the top edge
    expect(distanceToRectPerimeter(50, -10, 0, 0, 100, 50)).toBeCloseTo(10);
  });

  it("returns distance to nearest corner for a point in a corner region", () => {
    // Point at (-3, -4) — nearest corner is (0,0), distance = 5
    expect(distanceToRectPerimeter(-3, -4, 0, 0, 100, 50)).toBeCloseTo(5);
  });

  it("handles reversed corner order (x2 < x1)", () => {
    // Same rect, corners swapped
    expect(distanceToRectPerimeter(50, 0, 100, 50, 0, 0)).toBeCloseTo(0);
  });
});

// ─────────────────────────────────────────────
// isHitHLine
// ─────────────────────────────────────────────
describe("isHitHLine", () => {
  it("hits when cursor is within threshold", () => {
    expect(isHitHLine(105, 100, 8)).toBe(true);
  });

  it("misses when cursor is exactly at threshold", () => {
    expect(isHitHLine(108, 100, 8)).toBe(false);
  });

  it("misses when cursor is beyond threshold", () => {
    expect(isHitHLine(115, 100, 8)).toBe(false);
  });
});

// ─────────────────────────────────────────────
// isHitRay
// ─────────────────────────────────────────────
describe("isHitRay", () => {
  it("hits a point on the ray body", () => {
    expect(isHitRay(5, 0, 0, 0, 10, 0, 8)).toBe(true);
  });

  it("hits a point past b (semi-infinite extension)", () => {
    expect(isHitRay(20, 0, 0, 0, 10, 0, 8)).toBe(true);
  });

  it("does NOT hit a point behind the origin by more than threshold", () => {
    // Behind origin at (-20, 0): t<0, distance = 20 → miss
    expect(isHitRay(-20, 0, 0, 0, 10, 0, 8)).toBe(false);
  });

  it("misses a point far off the ray perpendicular", () => {
    expect(isHitRay(5, 20, 0, 0, 10, 0, 8)).toBe(false);
  });
});

// ─────────────────────────────────────────────
// isHitChannel
// ─────────────────────────────────────────────
describe("isHitChannel", () => {
  // Main line: (0,0)→(100,0), Parallel line: (0,20)→(100,20)
  it("hits when cursor is near the main line", () => {
    expect(isHitChannel(50, 3, 0, 0, 100, 0, 0, 20, 100, 20, 8)).toBe(true);
  });

  it("hits when cursor is near the parallel line", () => {
    expect(isHitChannel(50, 17, 0, 0, 100, 0, 0, 20, 100, 20, 8)).toBe(true);
  });

  it("misses when cursor is between the lines (not near either)", () => {
    expect(isHitChannel(50, 10, 0, 0, 100, 0, 0, 20, 100, 20, 8)).toBe(false);
  });
});

// ─────────────────────────────────────────────
// isHitPriceRange
// ─────────────────────────────────────────────
describe("isHitPriceRange", () => {
  // Rectangle: (0,0)→(100,50)
  it("hits near the top border", () => {
    expect(isHitPriceRange(50, 4, 0, 0, 100, 50, 8)).toBe(true);
  });

  it("hits near the right border", () => {
    expect(isHitPriceRange(96, 25, 0, 0, 100, 50, 8)).toBe(true);
  });

  it("misses an interior point far from borders", () => {
    expect(isHitPriceRange(50, 25, 0, 0, 100, 50, 8)).toBe(false);
  });

  it("misses a point outside the rect far from any edge", () => {
    expect(isHitPriceRange(50, -20, 0, 0, 100, 50, 8)).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Ray clip math — verify endpoint projection
// ─────────────────────────────────────────────
describe("ray clip math (endpoint projection)", () => {
  /**
   * Given ray from (x1,y1) toward (x2,y2) and canvas dimensions,
   * compute the endpoint using the same algorithm as Ray.tsx.
   */
  function clipRay(
    x1: number, y1: number, x2: number, y2: number,
    canvasWidth: number, canvasHeight: number,
  ): [number, number] {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.abs(dx) < 0.001) {
      return [x1, dy >= 0 ? canvasHeight : 0];
    }
    const slope = dy / dx;
    const b = y1 - slope * x1;
    const targetX = dx > 0 ? canvasWidth : 0;
    return [targetX, slope * targetX + b];
  }

  it("rightward ray ends at right canvas edge", () => {
    // From (100,200) toward (200,200) on 800x600 canvas
    const [ex, ey] = clipRay(100, 200, 200, 200, 800, 600);
    expect(ex).toBe(800);
    expect(ey).toBeCloseTo(200);
  });

  it("leftward ray ends at left canvas edge (x=0)", () => {
    // From (300,200) toward (200,200)
    const [ex, ey] = clipRay(300, 200, 200, 200, 800, 600);
    expect(ex).toBe(0);
    expect(ey).toBeCloseTo(200);
  });

  it("vertical downward ray ends at bottom edge", () => {
    const [ex, ey] = clipRay(100, 100, 100, 200, 800, 600);
    expect(ex).toBe(100);
    expect(ey).toBe(600);
  });

  it("vertical upward ray ends at top edge (y=0)", () => {
    const [ex, ey] = clipRay(100, 200, 100, 100, 800, 600);
    expect(ex).toBe(100);
    expect(ey).toBe(0);
  });

  it("diagonal 45-degree ray endpoint follows slope", () => {
    // From (0,0) slope=1, rightward: endpoint at x=800, y=800
    const [ex, ey] = clipRay(0, 0, 50, 50, 800, 600);
    expect(ex).toBe(800);
    expect(ey).toBeCloseTo(800);
  });
});

// ─────────────────────────────────────────────
// Channel perpendicular snap — zoom invariance
// ─────────────────────────────────────────────
describe("channel perpendicular snap under different zoom factors", () => {
  /**
   * Simulate two zoom levels by scaling screen coordinates.
   * The stored p3 should produce the same physical perpendicular distance
   * regardless of zoom — i.e. the parallel line's screen offset scales linearly.
   */
  it("perpendicular offset scales linearly with zoom", () => {
    // Main line: horizontal at y=0, from x=0 to x=100.
    // p3 is 10 screen-pixels above (y=-10) the midpoint.
    // At zoom 1: offset.dy = -10
    // At zoom 2 (all coords doubled): offset.dy = -20 (scales with zoom — expected)
    const r1 = perpendicularOffset(0, 0, 100, 0, 50, -10);
    const r2 = perpendicularOffset(0, 0, 200, 0, 100, -20);
    // At zoom 2 all coords are doubled so the offset should also double
    expect(r2.dy).toBeCloseTo(r1.dy * 2);
    expect(r2.dx).toBeCloseTo(r1.dx * 2);
  });

  it("parallel lines remain equidistant after zoom", () => {
    // After computing the offset, the perpendicular distance between
    // the main line and the parallel line should equal |offset|.
    const p1x = 0, p1y = 0, p2x = 100, p2y = 0;
    const p3x = 50, p3y = 30; // 30px below
    const offset = perpendicularOffset(p1x, p1y, p2x, p2y, p3x, p3y);
    // The distance between any two corresponding points on main vs parallel
    const dist = Math.hypot(offset.dx, offset.dy);
    expect(dist).toBeCloseTo(30);
  });
});

// ─────────────────────────────────────────────
// distanceToSegment (existing helper — regression guard)
// ─────────────────────────────────────────────
describe("distanceToSegment (regression)", () => {
  it("returns 0 for a point on the segment", () => {
    expect(distanceToSegment(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  it("returns distance to nearest endpoint for a point beyond the segment", () => {
    // Point at (15, 0), segment (0,0)→(10,0): nearest end is (10,0), dist=5
    expect(distanceToSegment(15, 0, 0, 0, 10, 0)).toBeCloseTo(5);
  });
});
