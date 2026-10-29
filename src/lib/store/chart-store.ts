"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Timeframe } from "@/lib/binance/types";
// Relative: the price worker reaches this module and its image has no `@/` paths.
import { MAX_COMPARE, PORTFOLIO_SERIES } from "../compare-series";
import type { CompareRange } from "../chart/compare";

export { MAX_COMPARE };
/** Mi cartera as a chart symbol: the stock portfolio's return. */
export const PORTFOLIO_SYMBOL = PORTFOLIO_SERIES;
/** The automatic Cartera list: the stocks held, never stored or edited. */
export const CARTERA_LIST_ID = "__cartera__";

export type IndicatorKey =
  | "ema20"
  | "ema50"
  | "ema200"
  | "rsi"
  | "macd"
  | "volume"
  | "bollinger"
  | "obv"
  | "stochastic"
  | "adx";

export interface IndicatorConfig {
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bbPeriod: number;
  bbStdDev: number;
  stochK: number;
  stochSmooth: number;
  stochD: number;
  adxPeriod: number;
}

export const DEFAULT_CONFIG: IndicatorConfig = {
  ema20: 20,
  ema50: 50,
  ema200: 200,
  rsi: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  bbPeriod: 20,
  bbStdDev: 2,
  stochK: 14,
  stochSmooth: 3,
  stochD: 3,
  adxPeriod: 14,
};

export const INDICATOR_COLORS: Record<IndicatorKey, string> = {
  ema20: "#00BCD4", // Cyan
  ema50: "#FF9800", // Orange
  ema200: "#E91E63", // Pink/Rose
  rsi: "#7E57C2",    // Purple
  macd: "#2196F3",   // Blue
  volume: "#787b86", // Gray
  bollinger: "#2962FF",
  obv: "#FF6D00",
  stochastic: "#2196F3", // Blue
  adx: "#B0BEC5",   // Muted Blue/Gray
};

export const DEFAULT_WATCHLIST = [
  "SPY",
  "QQQ",
  "IWM",
  "BTCUSDT",
  "ETHUSDT",
];

/** Every indicator false: none hidden, none minimized. */
const NONE: Record<IndicatorKey, boolean> = {
  ema20: false,
  ema50: false,
  ema200: false,
  rsi: false,
  macd: false,
  volume: false,
  bollinger: false,
  obv: false,
  stochastic: false,
  adx: false,
};

interface ChartState {
  symbol: string;
  timeframe: Timeframe;
  /** With `hidden` and `minimized`: this device's copy of the account's (src/lib/chart/indicator-sync.ts). */
  indicators: Record<IndicatorKey, boolean>;
  hidden: Record<IndicatorKey, boolean>;
  /** A pane shrunk to a thin labeled strip, its indicator still on (odd/tasks/chart-pro-redesign.md S1). */
  minimized: Record<IndicatorKey, boolean>;
  config: IndicatorConfig;
  watchlist: string[];
  activeWatchlistId: string | null;
  showPortfolioOverlay: boolean;
  /** The user's buys and sells as arrows on the candles ("Mostrar operaciones"). */
  showTrades: boolean;
  /** The assets drawn over every chart to compare with it, on this device. */
  compareSymbols: string[];
  /** Mi cartera already opened once against SPY on this device: the default is not applied again. */
  compareDefaulted: boolean;
  /** How far back comparisons start: every line is at 0 % on its first day. */
  compareRange: CompareRange;

  symbolDialogOpen: boolean;
  symbolDialogOnSelect: ((s: string) => void) | null;
  settingsTarget: IndicatorKey | null;

  setSymbol: (s: string) => void;
  setTimeframe: (t: Timeframe) => void;
  toggleIndicator: (key: IndicatorKey) => void;
  removeIndicator: (key: IndicatorKey) => void;
  toggleHidden: (key: IndicatorKey) => void;
  toggleMinimized: (key: IndicatorKey) => void;
  setConfig: (patch: Partial<IndicatorConfig>) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  setSymbolDialogOpen: (v: boolean, onSelect?: (s: string) => void) => void;
  setSettingsTarget: (k: IndicatorKey | null) => void;
  togglePortfolioOverlay: () => void;
  toggleShowTrades: () => void;
  setCompareSymbols: (symbols: string[]) => void;
  setCompareRange: (range: CompareRange) => void;
  setActiveWatchlistId: (id: string | null) => void;
  watchlistRefreshTick: number;
  bumpWatchlistRefresh: () => void;
}

export const useChartStore = create<ChartState>()(
  persist(
    (set) => ({
      symbol: "SPY",
      timeframe: "1d" as Timeframe,
      indicators: {
        ema20: true,
        ema50: true,
        ema200: true,
        rsi: true,
        macd: true,
        volume: true,
        bollinger: false,
        obv: false,
        stochastic: true,
        adx: true,
      },
      hidden: { ...NONE },
      minimized: { ...NONE },
      config: { ...DEFAULT_CONFIG },
      watchlist: DEFAULT_WATCHLIST,
      activeWatchlistId: null,
      showPortfolioOverlay: true,
      showTrades: true,
      compareSymbols: [],
      compareDefaulted: false,
      compareRange: "1A" as CompareRange,
      symbolDialogOpen: false,
      symbolDialogOnSelect: null,
      settingsTarget: null,
      watchlistRefreshTick: 0,

      setSymbol: (symbol) => set({ symbol }),
      setTimeframe: (timeframe) => set({ timeframe }),
      toggleIndicator: (key) =>
        set((s) => ({
          indicators: { ...s.indicators, [key]: !s.indicators[key] },
          hidden: !s.indicators[key]
            ? { ...s.hidden, [key]: false }
            : s.hidden,
          minimized: !s.indicators[key]
            ? { ...s.minimized, [key]: false }
            : s.minimized,
        })),
      removeIndicator: (key) =>
        set((s) => ({
          indicators: { ...s.indicators, [key]: false },
          hidden: { ...s.hidden, [key]: false },
          minimized: { ...s.minimized, [key]: false },
        })),
      toggleHidden: (key) =>
        set((s) => ({ hidden: { ...s.hidden, [key]: !s.hidden[key] } })),
      toggleMinimized: (key) =>
        set((s) => ({ minimized: { ...s.minimized, [key]: !s.minimized[key] } })),
      setConfig: (patch) =>
        set((s) => ({ config: { ...s.config, ...patch } })),
      addToWatchlist: (s) =>
        set((state) => ({
          watchlist: state.watchlist.includes(s)
            ? state.watchlist
            : [...state.watchlist, s],
        })),
      removeFromWatchlist: (s) =>
        set((state) => ({
          watchlist: state.watchlist.filter((x) => x !== s),
        })),
      setSymbolDialogOpen: (v, onSelect) =>
        set({ symbolDialogOpen: v, symbolDialogOnSelect: v ? (onSelect ?? null) : null }),
      setSettingsTarget: (settingsTarget) => set({ settingsTarget }),
      togglePortfolioOverlay: () =>
        set((s) => ({ showPortfolioOverlay: !s.showPortfolioOverlay })),
      toggleShowTrades: () => set((s) => ({ showTrades: !s.showTrades })),
      setCompareSymbols: (symbols) => set({ compareSymbols: [...new Set(symbols)].slice(0, MAX_COMPARE) }),
      setCompareRange: (compareRange) => set({ compareRange }),
      setActiveWatchlistId: (activeWatchlistId) => set({ activeWatchlistId }),
      bumpWatchlistRefresh: () =>
        set((s) => ({ watchlistRefreshTick: s.watchlistRefreshTick + 1 })),
    }),
    {
      name: "tv-gratis-chart-state",
      partialize: (s) => ({
        symbol: s.symbol,
        timeframe: s.timeframe,
        indicators: s.indicators,
        hidden: s.hidden,
        // A state saved before it has none: the merge keeps the default (every pane open).
        minimized: s.minimized,
        config: s.config,
        watchlist: s.watchlist,
        activeWatchlistId: s.activeWatchlistId,
        showPortfolioOverlay: s.showPortfolioOverlay,
        // A state saved before it has none: the merge keeps the default (on), no migration needed.
        showTrades: s.showTrades,
        compareSymbols: s.compareSymbols,
        compareDefaulted: s.compareDefaulted,
        compareRange: s.compareRange,
      }),
    },
  ),
);
