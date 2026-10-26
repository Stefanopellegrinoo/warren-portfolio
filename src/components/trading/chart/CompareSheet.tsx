"use client";

import { Search } from "lucide-react";
import { MAX_COMPARE, PORTFOLIO_SYMBOL, useChartStore } from "@/lib/store/chart-store";
import { seriesLabel } from "@/lib/compare-series";
import { ChartSheet } from "./ChartSheet";

/** The ETFs offered at once; any other ticker comes from the search. */
const QUICK = ["SPY", "QQQ", "DIA", "EEM", "VT", "^MERV"];

/** What to draw over the chart to compare with it: Mi cartera, the quick ETFs, or any ticker found. */
export function CompareSheet({ open, onOpenChange, main }: { open: boolean; onOpenChange: (open: boolean) => void; main: string }) {
	const compared = useChartStore((s) => s.compareSymbols);
	const setCompared = useChartStore((s) => s.setCompareSymbols);
	const openSearch = useChartStore((s) => s.setSymbolDialogOpen);

	const offered = [...(main === PORTFOLIO_SYMBOL ? [] : [PORTFOLIO_SYMBOL]), ...QUICK.filter((s) => s !== main)];
	// Tickers found by search stay listed, checked, so they can be taken out here too.
	const options = [...offered, ...compared.filter((s) => !offered.includes(s))];
	const full = compared.length >= MAX_COMPARE;

	const toggle = (symbol: string) =>
		setCompared(compared.includes(symbol) ? compared.filter((s) => s !== symbol) : [...compared, symbol]);

	const search = () => {
		onOpenChange(false);
		openSearch(true, (symbol) => setCompared([...useChartStore.getState().compareSymbols, symbol]));
	};

	return (
		<ChartSheet open={open} onOpenChange={onOpenChange} title="Comparar con">
			<ul className="divide-y divide-line">
				{options.map((symbol) => {
					const checked = compared.includes(symbol);
					return (
						<li key={symbol}>
							<label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px] text-ink has-[:disabled]:cursor-default has-[:disabled]:text-ink-3">
								<input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => toggle(symbol)} className="h-4 w-4 accent-[var(--accent)]" />
								{seriesLabel(symbol)}
							</label>
						</li>
					);
				})}
			</ul>
			{full && <p className="pt-2 text-[13px] text-ink-3">Podés comparar hasta {MAX_COMPARE} a la vez.</p>}
			<button
				type="button"
				onClick={search}
				disabled={full}
				className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-line text-[14px] text-ink hover:bg-hover disabled:text-ink-3"
			>
				<Search className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
				Buscar otro
			</button>
		</ChartSheet>
	);
}
