import { describe, it, expect } from "vitest";
import { obv, stochastic, adx, bollinger } from "@/lib/indicators";
import type { Candle } from "@/lib/binance/types";

function c(
  time: number,
  close: number,
  volume = 1000,
  high?: number,
  low?: number,
): Candle {
  return {
    time,
    open: close,
    high: high ?? close,
    low: low ?? close,
    close,
    volume,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Bollinger Bands
// ──────────────────────────────────────────────────────────────────────────────

describe("bollinger", () => {
  it("returns empty array when candles < period", () => {
    const result = bollinger([c(1, 10), c(2, 12)], 5, 2);
    expect(result).toHaveLength(0);
  });

  it("computes correct middle, upper, lower for period=5", () => {
    // closes: 10, 12, 14, 16, 18 → mean = 14
    // deviations from 14: -4, -2, 0, 2, 4
    // population variance = (16+4+0+4+16)/5 = 8
    // std = sqrt(8) ≈ 2.8284
    const candles = [c(1, 10), c(2, 12), c(3, 14), c(4, 16), c(5, 18)];
    const result = bollinger(candles, 5, 2);
    expect(result).toHaveLength(1);
    expect(result[0].middle).toBeCloseTo(14, 5);
    expect(result[0].upper).toBeCloseTo(14 + 2 * Math.sqrt(8), 4);
    expect(result[0].lower).toBeCloseTo(14 - 2 * Math.sqrt(8), 4);
  });

  it("upper === middle === lower when period=1 (std=0)", () => {
    const result = bollinger([c(1, 100)], 1, 2);
    expect(result).toHaveLength(1);
    expect(result[0].upper).toBe(result[0].middle);
    expect(result[0].lower).toBe(result[0].middle);
    expect(result[0].middle).toBe(100);
  });

  it("returns multiple points for enough candles", () => {
    const candles = Array.from({ length: 25 }, (_, i) => c(i + 1, 100 + i));
    const result = bollinger(candles, 20, 2);
    expect(result).toHaveLength(6); // 25 - 20 + 1
    for (const p of result) {
      expect(p.upper).toBeGreaterThan(p.middle);
      expect(p.lower).toBeLessThan(p.middle);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// OBV
// ──────────────────────────────────────────────────────────────────────────────

describe("obv", () => {
  it("returns [0] for a single candle", () => {
    const result = obv([c(1, 100, 500)]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
  });

  it("returns empty array for empty input", () => {
    expect(obv([])).toHaveLength(0);
  });

  it("accumulates correctly across up/down/flat days", () => {
    const candles = [
      c(1, 100, 1000),
      c(2, 101, 2000), // up → +2000
      c(3, 99, 1500),  // down → -1500
      c(4, 99, 800),   // flat → 0
      c(5, 102, 3000), // up → +3000
    ];
    const result = obv(candles);
    expect(result).toHaveLength(5);
    expect(result[0].value).toBe(0);
    expect(result[1].value).toBe(2000);
    expect(result[2].value).toBe(500);
    expect(result[3].value).toBe(500); // flat, unchanged
    expect(result[4].value).toBe(3500);
  });

  it("stays at 0 when all closes are equal", () => {
    const candles = [c(1, 100, 500), c(2, 100, 700), c(3, 100, 300), c(4, 100, 900), c(5, 100, 600)];
    const result = obv(candles);
    expect(result.every((p) => p.value === 0)).toBe(true);
  });

  it("assigns correct times to each point", () => {
    const candles = [c(10, 100, 500), c(20, 101, 200)];
    const result = obv(candles);
    expect(result[0].time).toBe(10);
    expect(result[1].time).toBe(20);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Stochastic
// ──────────────────────────────────────────────────────────────────────────────

describe("stochastic", () => {
  it("returns empty when candles < kPeriod", () => {
    const candles = [c(1, 10), c(2, 12)];
    expect(stochastic(candles, 14, 3, 3)).toHaveLength(0);
  });

  it("returns k=50 when highest === lowest (no crash)", () => {
    // All candles identical → range=0 → fallback to 50
    const candles = Array.from({ length: 20 }, (_, i) => c(i + 1, 100, 1000, 100, 100));
    const result = stochastic(candles, 14, 1, 1);
    expect(result.length).toBeGreaterThan(0);
    for (const p of result) {
      expect(p.k).toBe(50);
    }
  });

  it("returns points with k and d in [0, 100] for real data", () => {
    const candles = [
      c(1,  44, 1000, 47, 40),
      c(2,  50, 1000, 52, 43),
      c(3,  55, 1000, 58, 48),
      c(4,  60, 1000, 63, 53),
      c(5,  58, 1000, 61, 55),
      c(6,  53, 1000, 60, 50),
      c(7,  48, 1000, 55, 44),
      c(8,  45, 1000, 50, 41),
      c(9,  50, 1000, 53, 46),
      c(10, 56, 1000, 59, 50),
      c(11, 60, 1000, 63, 54),
      c(12, 63, 1000, 66, 58),
      c(13, 61, 1000, 65, 56),
      c(14, 58, 1000, 62, 53),
      c(15, 55, 1000, 59, 50),
      c(16, 52, 1000, 57, 48),
      c(17, 48, 1000, 53, 44),
      c(18, 45, 1000, 50, 40),
      c(19, 50, 1000, 54, 45),
      c(20, 57, 1000, 60, 50),
    ];
    const result = stochastic(candles, 14, 3, 3);
    expect(result.length).toBeGreaterThan(0);
    for (const p of result) {
      expect(p.k).toBeGreaterThanOrEqual(0);
      expect(p.k).toBeLessThanOrEqual(100);
      expect(p.d).toBeGreaterThanOrEqual(0);
      expect(p.d).toBeLessThanOrEqual(100);
    }
  });

  it("returns empty when not enough points after smoothing", () => {
    // kPeriod=14, kSmooth=3, dPeriod=3: need at least 14+3-1+3-1=19 candles for 1 result
    // With 15 candles: rawK has 2 points; 2 < kSmooth(3) → return []
    const candles = Array.from({ length: 15 }, (_, i) =>
      c(i + 1, 100 + i, 1000, 105 + i, 95 + i),
    );
    expect(stochastic(candles, 14, 3, 3)).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// ADX
// ──────────────────────────────────────────────────────────────────────────────

describe("adx", () => {
  it("returns empty when candles.length < period * 2", () => {
    const candles = Array.from({ length: 20 }, (_, i) => c(i + 1, 100 + i));
    expect(adx(candles, 14)).toHaveLength(0);
  });

  it("returns empty for very short inputs", () => {
    expect(adx([c(1, 100), c(2, 101)], 14)).toHaveLength(0);
  });

  it("returns ADX values all >= 0 and <= 100 for realistic data", () => {
    // Generate 60 candles with monotonic uptrend
    const candles: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      const base = 100 + i * 2;
      candles.push(c(i + 1, base, 1000, base + 3, base - 2));
    }
    const result = adx(candles, 14);
    expect(result.length).toBeGreaterThan(0);
    for (const p of result) {
      expect(p.adx).toBeGreaterThanOrEqual(0);
      expect(p.adx).toBeLessThanOrEqual(100);
      expect(p.plusDI).toBeGreaterThanOrEqual(0);
      expect(p.minusDI).toBeGreaterThanOrEqual(0);
    }
  });

  it("+DI > -DI during a consistent uptrend", () => {
    // Strong uptrend: each bar has higher high, higher low
    const candles: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      const base = 100 + i * 3;
      candles.push(c(i + 1, base, 1000, base + 4, base - 1));
    }
    const result = adx(candles, 14);
    expect(result.length).toBeGreaterThan(0);
    // Check the last several points in a strong uptrend
    const recent = result.slice(-10);
    const plusDominates = recent.every((p) => p.plusDI > p.minusDI);
    expect(plusDominates).toBe(true);
  });

  it("assigns correct time from candle index", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 35; i++) {
      const base = 100 + i;
      candles.push({ time: (i + 1) * 1000, open: base, high: base + 2, low: base - 1, close: base, volume: 500 });
    }
    const result = adx(candles, 14);
    expect(result.length).toBeGreaterThan(0);
    // All times should be positive and from the candle array
    for (const p of result) {
      expect(p.time).toBeGreaterThan(0);
    }
  });
});
