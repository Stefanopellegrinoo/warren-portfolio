"use client";

import { useMemo } from "react";
import { useCached } from "@/lib/client-cache";
import { getTransactions } from "@/lib/warren/positions";
import { tradesByBar, type Trade } from "@/lib/chart/trade-markers";
import type { Candle } from "@/lib/binance/types";

const NONE: Trade[] = [];

/**
 * The symbol's buys and sells from the app's operations (the Historial's), by the bar that holds
 * them. The chart's symbol for a held asset is its position ticker ("AAPL", "BCBA:GGAL"), the
 * operations' own ticker; a coin pair matches none. Asked once per symbol and remembered in this
 * tab: a timeframe change asks nothing, a return to the page shows them at once and refreshes
 * behind. A failed request shows none and says nothing. Off (`shown` false), nothing is asked.
 */
export function useTradeMarkers(symbol: string, candles: readonly Candle[], shown: boolean) {
	// ponytail: the API's newest 500 of the symbol; page it if one asset ever holds more.
	const { data } = useCached(shown ? `chart:trades:${symbol}` : null, () => getTransactions(symbol));
	const trades = (shown && data) || NONE;
	return useMemo(() => tradesByBar(trades, candles.map((c) => c.time)), [trades, candles]);
}
