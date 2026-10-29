"use client";

import type { Timeframe } from "@/lib/binance/types";
import { rangeStart } from "@/lib/chart/compare";
import { cn } from "@/lib/utils";

/** How much history a chip shows (odd/tasks/chart-pro-redesign.md S6). */
export type RangeChip = "1D" | "5D" | "1M" | "3M" | "6M" | "1A" | "5A" | "Todo";
export type ScaleMode = "pct" | "log" | "auto";

const MINUTES: RangeChip[] = ["1D", "5D", "1M"];
const HOURS: RangeChip[] = ["5D", "1M", "3M"];
const BY_TIMEFRAME: Partial<Record<Timeframe, RangeChip[]>> = {
	"1d": ["1M", "3M", "6M", "1A", "5A", "Todo"],
	"3d": ["1M", "3M", "6M", "1A", "5A", "Todo"],
	"1w": ["6M", "1A", "5A", "Todo"],
	"1M": ["1A", "5A", "Todo"],
};

/** The chips a timeframe offers: a crypto's 1m or 4h take the nearest one's (15m, 1h). */
export function rangeChips(timeframe: Timeframe): RangeChip[] {
	return BY_TIMEFRAME[timeframe] ?? (timeframe.endsWith("h") ? HOURS : MINUTES);
}

const SESSIONS: Partial<Record<RangeChip, number>> = { "1D": 1, "5D": 5 };
const dayOf = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);

/** The first bar a chip shows, counted back from the last one: days with bars for 1D and 5D (a stock's
 *  5D is its last five sessions), the calendar for months and years. */
export function rangeFirstBar(chip: RangeChip, times: number[]): number {
	const last = times.at(-1);
	if (chip === "Todo" || last === undefined) return 0;
	const sessions = SESSIONS[chip];
	if (sessions) {
		let seen = 0;
		let day = "";
		for (let i = times.length - 1; i >= 0; i--) {
			if (dayOf(times[i]) === day) continue;
			day = dayOf(times[i]);
			if (++seen > sessions) return i + 1;
		}
		return 0;
	}
	const d = new Date(last * 1000);
	const from = chip === "5A" ? Date.UTC(d.getUTCFullYear() - 5, d.getUTCMonth(), d.getUTCDate()) / 1000 : rangeStart(chip as "1M" | "3M" | "6M" | "1A", last)!;
	return Math.max(0, times.findIndex((t) => t >= from));
}

const SCALES: { mode: ScaleMode; text: string; title: string }[] = [
	{ mode: "pct", text: "%", title: "Escala en porcentaje" },
	{ mode: "log", text: "log", title: "Escala logarítmica" },
	{ mode: "auto", text: "auto", title: "Escala automática" },
];
const chipClass = "rounded px-1.5 py-1 text-ink-3 hover:bg-hover hover:text-ink max-[819px]:min-h-8 max-[819px]:px-1";
const onClass = "bg-accent-soft font-medium text-accent-ink";

/**
 * The strip under the chart: the range chips (or, while comparing, the day every line starts from), the price
 * scale's mode and the TradingView credit, which the library's license asks for on a page users see, on a phone too.
 */
export function ChartRangeBar({
	chips,
	active,
	label,
	note = null,
	onPick,
	scale,
	onScale,
	percent,
}: {
	chips: readonly string[];
	active: string | null;
	label: string;
	note?: string | null;
	onPick: (chip: string) => void;
	scale: ScaleMode;
	onScale: (mode: ScaleMode) => void;
	/** The % mode, off while the scale already reads in % (comparing). */
	percent: boolean;
}) {
	return (
		<div className="flex flex-wrap items-center gap-x-2 border-t border-line px-2 text-[12px] tabular-nums max-[819px]:px-1">
			<div role="group" aria-label={label} className="flex items-center gap-0.5 max-[819px]:flex-1 max-[819px]:justify-between">
				{chips.map((chip) => (
					<button key={chip} type="button" aria-pressed={chip === active} onClick={() => onPick(chip)} className={cn(chipClass, chip === active && onClass)}>
						{chip}
					</button>
				))}
			</div>
			{note && <span className="text-ink-3 max-[819px]:hidden">{note}</span>}
			<div role="group" aria-label="Escala" className="ml-auto flex items-center gap-0.5 max-[819px]:hidden">
				{SCALES.filter((s) => percent || s.mode !== "pct").map((s) => (
					<button key={s.mode} type="button" title={s.title} aria-pressed={s.mode === scale} onClick={() => onScale(s.mode)} className={cn(chipClass, s.mode === scale && "font-medium text-accent-ink")}>
						{s.text}
					</button>
				))}
			</div>
			<a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap py-1 text-[11px] text-ink-3 hover:text-ink-2 max-[819px]:text-[10px]">
				Gráficos de TradingView
			</a>
		</div>
	);
}
