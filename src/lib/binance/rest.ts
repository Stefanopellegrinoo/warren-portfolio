import type { Quote } from "../../types";
import type { Candle, SymbolInfo, Ticker24h, Timeframe } from "./types";

const BASE = "https://api.binance.com/api/v3";
// The worker runs on a US server, and Binance refuses api.binance.com from the US:
// its public market-data host first, Binance.US (same API) when that one refuses too.
const SERVER_BASES = ["https://data-api.binance.vision/api/v3", "https://api.binance.us/api/v3"];

export async function fetchKlines(
  symbol: string,
  interval: Timeframe,
  limit = 1000,
): Promise<Candle[]> {
  const url = `${BASE}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`klines ${res.status}`);
  const data = (await res.json()) as unknown[][];
  return data.map((k) => ({
    time: Math.floor((k[0] as number) / 1000),
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
    isFinal: true,
  }));
}

export async function fetchTicker24h(symbol: string): Promise<Ticker24h> {
  const url = `${BASE}/ticker/24hr?symbol=${symbol.toUpperCase()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ticker ${res.status}`);
  const t = await res.json();
  return {
    symbol: t.symbol,
    lastPrice: parseFloat(t.lastPrice),
    priceChange: parseFloat(t.priceChange),
    priceChangePercent: parseFloat(t.priceChangePercent),
    highPrice: parseFloat(t.highPrice),
    lowPrice: parseFloat(t.lowPrice),
    volume: parseFloat(t.volume),
    quoteVolume: parseFloat(t.quoteVolume),
  };
}

export async function fetchTickers24h(symbols: string[], base = BASE): Promise<Ticker24h[]> {
  const arr = JSON.stringify(symbols.map((s) => s.toUpperCase()));
  const url = `${base}/ticker/24hr?symbols=${encodeURIComponent(arr)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`tickers ${res.status}`);
  const data = await res.json();
  return data.map((t: Record<string, string>) => ({
    symbol: t.symbol,
    lastPrice: parseFloat(t.lastPrice),
    priceChange: parseFloat(t.priceChange),
    priceChangePercent: parseFloat(t.priceChangePercent),
    highPrice: parseFloat(t.highPrice),
    lowPrice: parseFloat(t.lowPrice),
    volume: parseFloat(t.volume),
    quoteVolume: parseFloat(t.quoteVolume),
  }));
}

/** Crypto quotes for the price worker, in the same shape as the stock quotes. */
export async function fetchCryptoQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  let lastError: unknown;
  for (const base of SERVER_BASES) {
    try {
      const tickers = await fetchTickers24h(symbols, base);
      const updatedAt = new Date().toISOString();
      return new Map(tickers.map((t) => [t.symbol, {
        ticker: t.symbol,
        price: t.lastPrice,
        change: t.priceChange,
        changePercent: t.priceChangePercent / 100,
        previousClose: t.lastPrice - t.priceChange,
        updatedAt,
      }]));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

let cachedSymbols: SymbolInfo[] | null = null;
export async function fetchExchangeSymbols(): Promise<SymbolInfo[]> {
  if (cachedSymbols) return cachedSymbols;
  const res = await fetch(`${BASE}/exchangeInfo`, { cache: "force-cache" });
  if (!res.ok) throw new Error(`exchangeInfo ${res.status}`);
  const data = await res.json();
  cachedSymbols = data.symbols
    .filter(
      (s: { status: string; quoteAsset: string }) =>
        s.status === "TRADING" && s.quoteAsset === "USDT",
    )
    .map((s: { symbol: string; baseAsset: string; quoteAsset: string; status: string }) => ({
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      status: s.status,
    }));
  return cachedSymbols!;
}
