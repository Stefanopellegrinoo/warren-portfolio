/**
 * Determines the data provider for a given ticker symbol.
 * - Symbols ending in "USDT" are treated as Binance (Crypto).
 * - Mi cartera (`__portfolio__`) is the stock portfolio's own series.
 * - All other symbols are treated as Yahoo Finance (Stocks/CEDEARs).
 */
// Relative: the price worker imports this module and its image has no `@/` paths.
import { PORTFOLIO_SERIES } from "../compare-series";

export type DataSource = "binance" | "yahoo" | "portfolio";

export function getProviderForSymbol(symbol: string): DataSource {
  // Mi cartera: the stock portfolio's own series, served by /api/compare-series.
  if (symbol === PORTFOLIO_SERIES) return "portfolio";
  const s = symbol.toUpperCase();
  // Most crypto tickers in this app follow the Binance USDT pair convention
  if (s.endsWith("USDT")) {
    return "binance";
  }
  return "yahoo";
}
