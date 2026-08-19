"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Timeframe } from "@/lib/binance/types";
import type { ChartDrawing, InProgressDrawing, DrawingStyle } from "@/lib/types/drawings";
import { DEFAULT_STYLE } from "@/lib/types/drawings";

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

export type DrawingTool =
  | "cursor"
  | "hline"
  | "horizontal_ray"
  | "measure"
  | "eraser"
  | "trendline"
  | "fibonacci"
  | "ray"
  | "channel"
  | "price_range"
  | "arrow";

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

interface ChartState {
  symbol: string;
  timeframe: Timeframe;
  indicators: Record<IndicatorKey, boolean>;
  hidden: Record<IndicatorKey, boolean>;
  config: IndicatorConfig;
  watchlist: string[];
  activeWatchlistId: string | null;
  showPortfolioOverlay: boolean;
  magnetMode: boolean;
  /** Persisted custom style per tool type */
  toolStyles: Record<string, DrawingStyle>;

  tool: DrawingTool;
  symbolDialogOpen: boolean;
  drawings: ChartDrawing[];
  inProgressDrawing: InProgressDrawing | null;
  symbolDialogOnSelect: ((s: string) => void) | null;
  settingsTarget: IndicatorKey | null;

  addDrawing: (d: ChartDrawing) => void;
  updateDrawing: (id: string, patch: Partial<Pick<ChartDrawing, "points" | "style">>) => void;
  removeDrawing: (id: string) => void;
  clearDrawings: () => void;
  replaceDrawings: (drawings: ChartDrawing[]) => void;
  setInProgressDrawing: (d: InProgressDrawing | null) => void;
  setSymbol: (s: string) => void;
  setTimeframe: (t: Timeframe) => void;
  toggleIndicator: (key: IndicatorKey) => void;
  removeIndicator: (key: IndicatorKey) => void;
  toggleHidden: (key: IndicatorKey) => void;
  setConfig: (patch: Partial<IndicatorConfig>) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  setTool: (t: DrawingTool) => void;
  setSymbolDialogOpen: (v: boolean, onSelect?: (s: string) => void) => void;
  setSettingsTarget: (k: IndicatorKey | null) => void;
  togglePortfolioOverlay: () => void;
  setActiveWatchlistId: (id: string | null) => void;
  setMagnetMode: (active: boolean) => void;
  updateToolStyle: (tool: string, style: Partial<DrawingStyle>) => void;
  watchlistRefreshTick: number;
  bumpWatchlistRefresh: () => void;
}

export const useChartStore = create<ChartState>()(
  persist(
    (set) => ({
      symbol: "SPY",
      timeframe: "1w" as Timeframe,
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
      hidden: {
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
      },
      config: { ...DEFAULT_CONFIG },
      watchlist: DEFAULT_WATCHLIST,
      activeWatchlistId: null,
      showPortfolioOverlay: true,
      magnetMode: true,
      toolStyles: {},
      tool: "cursor",
      symbolDialogOpen: false,
      symbolDialogOnSelect: null,
      settingsTarget: null,
      watchlistRefreshTick: 0,
      drawings: [],
      inProgressDrawing: null,

      addDrawing: (d) =>
        set((state) => ({ drawings: [...state.drawings, d] })),
      updateDrawing: (id, patch) =>
        set((state) => ({
          drawings: state.drawings.map((d) =>
            d.id === id ? { ...d, ...patch } : d,
          ),
        })),
      removeDrawing: (id) =>
        set((state) => ({
          drawings: state.drawings.filter((d) => d.id !== id),
        })),
      clearDrawings: () => set({ drawings: [] }),
      replaceDrawings: (drawings) => set({ drawings }),
      setInProgressDrawing: (inProgressDrawing) => set({ inProgressDrawing }),
      setSymbol: (symbol) => set({ symbol }),
      setTimeframe: (timeframe) => set({ timeframe }),
      toggleIndicator: (key) =>
        set((s) => ({
          indicators: { ...s.indicators, [key]: !s.indicators[key] },
          hidden: !s.indicators[key]
            ? { ...s.hidden, [key]: false }
            : s.hidden,
        })),
      removeIndicator: (key) =>
        set((s) => ({
          indicators: { ...s.indicators, [key]: false },
          hidden: { ...s.hidden, [key]: false },
        })),
      toggleHidden: (key) =>
        set((s) => ({ hidden: { ...s.hidden, [key]: !s.hidden[key] } })),
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
      setTool: (tool) => set({ tool }),
      setSymbolDialogOpen: (v, onSelect) =>
        set({ symbolDialogOpen: v, symbolDialogOnSelect: v ? (onSelect ?? null) : null }),
      setSettingsTarget: (settingsTarget) => set({ settingsTarget }),
      togglePortfolioOverlay: () =>
        set((s) => ({ showPortfolioOverlay: !s.showPortfolioOverlay })),
      setActiveWatchlistId: (activeWatchlistId) => set({ activeWatchlistId }),
      setMagnetMode: (magnetMode) => set({ magnetMode }),
      updateToolStyle: (tool, style) =>
        set((s) => ({
          toolStyles: {
            ...s.toolStyles,
            [tool]: { ...(s.toolStyles[tool] || DEFAULT_STYLE[tool as keyof typeof DEFAULT_STYLE] || DEFAULT_STYLE.trendline), ...style },
          },
        })),
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
        config: s.config,
        watchlist: s.watchlist,
        activeWatchlistId: s.activeWatchlistId,
        showPortfolioOverlay: s.showPortfolioOverlay,
        magnetMode: s.magnetMode,
        toolStyles: s.toolStyles,
      }),
    },
  ),
);
