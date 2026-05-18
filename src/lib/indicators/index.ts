import type { Candle } from "@/lib/binance/types";
import type { ConditionRule } from "@/types";

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface MACDPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * Simple Moving Average
 */
export function sma(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

/**
 * Exponential Moving Average — seeded with SMA of first `period` candles.
 */
export function ema(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += candles[i].close;
  prev /= period;
  out.push({ time: candles[period - 1].time, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

/**
 * RSI (Wilder) — period typically 14.
 */
export function rsi(candles: Candle[], period = 14): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  let rs = loss === 0 ? 100 : gain / loss;
  out.push({ time: candles[period].time, value: 100 - 100 / (1 + rs) });
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    rs = loss === 0 ? 100 : gain / loss;
    out.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
  }
  return out;
}

/**
 * MACD — fast EMA, slow EMA, signal EMA of the MACD line.
 * Defaults: 12 / 26 / 9.
 */
export function macd(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signal = 9,
): MACDPoint[] {
  if (candles.length < slow + signal) return [];
  const emaFast = ema(candles, fast);
  const emaSlow = ema(candles, slow);
  // align: emaSlow starts later
  const slowStartTime = emaSlow[0].time;
  const fastByTime = new Map(emaFast.map((p) => [p.time, p.value]));
  const macdLine: IndicatorPoint[] = [];
  for (const p of emaSlow) {
    const f = fastByTime.get(p.time);
    if (f !== undefined) macdLine.push({ time: p.time, value: f - p.value });
  }
  // signal = EMA of MACD line. Build synthetic candles for ema()
  const synth: Candle[] = macdLine.map((p) => ({
    time: p.time,
    open: p.value,
    high: p.value,
    low: p.value,
    close: p.value,
    volume: 0,
  }));
  const sig = ema(synth, signal);
  const sigByTime = new Map(sig.map((p) => [p.time, p.value]));
  const out: MACDPoint[] = [];
  for (const p of macdLine) {
    const s = sigByTime.get(p.time);
    if (s === undefined) continue;
    out.push({ time: p.time, macd: p.value, signal: s, histogram: p.value - s });
  }
  void slowStartTime;
  return out;
}

export interface BollingerPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

export interface ComputedState {
  candles: Candle[];
  ema: Record<number, IndicatorPoint[]>;
  rsi: Record<number, IndicatorPoint[]>;
  macd: MACDPoint[];
  bollinger: BollingerPoint[];
  volumeAvg: Record<number, IndicatorPoint[]>;
}

export function bollinger(
  candles: Candle[],
  period = 20,
  stdDev = 2,
): BollingerPoint[] {
  const out: BollingerPoint[] = [];
  if (candles.length < period) return out;
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const middle = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = candles[j].close - middle;
      variance += diff * diff;
    }
    const std = Math.sqrt(variance / period);
    out.push({
      time: candles[i].time,
      upper: middle + stdDev * std,
      middle,
      lower: middle - stdDev * std,
    });
  }
  return out;
}

export function volumeAvg(candles: Candle[], period = 20): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].volume;
    if (i >= period) sum -= candles[i - period].volume;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

export function evaluateConditions(
  conditions: ConditionRule[],
  state: ComputedState,
): boolean {
  if (conditions.length === 0) return false;

  for (const rule of conditions) {
    if (!evaluateSingle(rule, state)) return false;
  }
  return true;
}

function evaluateSingle(rule: ConditionRule, state: ComputedState): boolean {
  switch (rule.indicator) {
    case "EMA": {
      const series = state.ema[rule.period ?? 20];
      if (!series || series.length === 0) return false;
      const op = rule.operator;
      if (op === "gt" || op === "lt" || op === "gte" || op === "lte") {
        if (rule.value === undefined) return false;
        const last = series[series.length - 1].value;
        return compareScalar(last, op, rule.value);
      }
      if (op === "crosses_above" || op === "crosses_below") {
        if (series.length < 2) return false;
        const curr = series[series.length - 1].value;
        const prev = series[series.length - 2].value;
        let targetCurr: number;
        let targetPrev: number;
        if (rule.target === "EMA" && rule.targetPeriod !== undefined) {
          const tSeries = state.ema[rule.targetPeriod];
          if (!tSeries || tSeries.length < 2) return false;
          targetCurr = tSeries[tSeries.length - 1].value;
          targetPrev = tSeries[tSeries.length - 2].value;
        } else if (rule.value !== undefined) {
          targetCurr = rule.value;
          targetPrev = rule.value;
        } else {
          return false;
        }
        if (op === "crosses_above") return prev <= targetPrev && curr > targetCurr;
        return prev >= targetPrev && curr < targetCurr;
      }
      return false;
    }

    case "RSI": {
      const series = state.rsi[rule.period ?? 14];
      if (!series || series.length === 0) return false;
      const op = rule.operator;
      if (op === "gt" || op === "lt" || op === "gte" || op === "lte") {
        if (rule.value === undefined) return false;
        const last = series[series.length - 1].value;
        return compareScalar(last, op, rule.value);
      }
      if (op === "crosses_above" || op === "crosses_below") {
        if (series.length < 2 || rule.value === undefined) return false;
        const curr = series[series.length - 1].value;
        const prev = series[series.length - 2].value;
        if (op === "crosses_above") return prev <= rule.value && curr > rule.value;
        return prev >= rule.value && curr < rule.value;
      }
      return false;
    }

    case "MACD": {
      const m = state.macd;
      if (!m || m.length === 0) return false;
      const op = rule.operator;
      if (op === "crosses_above" || op === "crosses_below") {
        if (m.length < 2) return false;
        const curr = m[m.length - 1];
        const prev = m[m.length - 2];
        if (op === "crosses_above") return prev.macd <= prev.signal && curr.macd > curr.signal;
        return prev.macd >= prev.signal && curr.macd < curr.signal;
      }
      if (op === "gt" || op === "lt" || op === "gte" || op === "lte") {
        if (rule.value === undefined) return false;
        return compareScalar(m[m.length - 1].macd, op, rule.value);
      }
      return false;
    }

    case "Bollinger": {
      const boll = state.bollinger;
      if (!boll || boll.length === 0) return false;
      const candles = state.candles;
      const op = rule.operator;
      if (op === "lt") {
        return candles[candles.length - 1].close < boll[boll.length - 1].lower;
      }
      if (op === "gt") {
        return candles[candles.length - 1].close > boll[boll.length - 1].upper;
      }
      if (op === "crosses_below" || op === "crosses_above") {
        if (boll.length < 2 || candles.length < 2) return false;
        const cCurr = candles[candles.length - 1].close;
        const cPrev = candles[candles.length - 2].close;
        if (op === "crosses_below") {
          return cPrev >= boll[boll.length - 2].lower && cCurr < boll[boll.length - 1].lower;
        }
        return cPrev <= boll[boll.length - 2].upper && cCurr > boll[boll.length - 1].upper;
      }
      return false;
    }

    case "Volume": {
      const period = rule.period ?? 20;
      const avgSeries = state.volumeAvg[period];
      if (!avgSeries || avgSeries.length === 0) return false;
      const avg = avgSeries[avgSeries.length - 1].value;
      if (avg === 0) return false;
      if (rule.value === undefined) return false;
      const candles = state.candles;
      const ratio = candles[candles.length - 1].volume / avg;
      return compareScalar(ratio, rule.operator, rule.value);
    }

    default:
      return false;
  }
}

function compareScalar(
  a: number,
  op: "gt" | "lt" | "gte" | "lte" | "crosses_above" | "crosses_below",
  b: number,
): boolean {
  switch (op) {
    case "gt": return a > b;
    case "lt": return a < b;
    case "gte": return a >= b;
    case "lte": return a <= b;
    default: return false;
  }
}
