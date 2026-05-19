/**
 * Determines the data provider for a given ticker symbol.
 * - Symbols ending in "USDT" are treated as Binance (Crypto).
 * - All other symbols are treated as Yahoo Finance (Stocks/CEDEARs).
 */
export type DataSource = "binance" | "yahoo";

export function getProviderForSymbol(symbol: string): DataSource {
  const s = symbol.toUpperCase();
  // Most crypto tickers in this app follow the Binance USDT pair convention
  if (s.endsWith("USDT")) {
    return "binance";
  }
  return "yahoo";
}
