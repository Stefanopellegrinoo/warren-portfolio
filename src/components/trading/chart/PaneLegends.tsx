"use client";

import { useState } from "react";
import { ChevronRight, Eye, EyeOff, Minus, Settings2, X } from "lucide-react";
import { useChartStore, type IndicatorConfig, type IndicatorKey } from "@/lib/store/chart-store";
import { CANDLE_COLORS, INDICATOR_SPECS, type IndicatorLine } from "@/lib/chart/indicator-specs";
import { lineLook } from "@/lib/chart/indicator-style";
import type { ChartPreferences, IndicatorStyle } from "@/lib/chart/preferences-schema";
import { priceDecimals } from "@/lib/chart/alerts";
import { cn, formatNumber } from "@/lib/utils";

/**
 * Every pane's legend (odd/tasks/chart-pro-redesign.md S1): the price pane's at the chart's top-left, between
 * the candle data (`head`) and the comparisons (`children`); each indicator pane's at its own top-left. Each
 * indicator is named with its values at the crosshair (or the last bar) and its actions: minimize (panes only),
 * hide, settings, remove. On a phone the price pane's values wait for a finger on the chart (S7).
 */

const LABELS: Record<string, string> = { k: "%K", d: "%D", adx: "ADX", plusDI: "+DI", minusDI: "−DI" };
const ONE_DECIMAL: IndicatorKey[] = ["rsi", "stochastic", "adx"];
const COMPACT: IndicatorKey[] = ["volume", "obv"];
const compact = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });
// Under its pane's top edge, clear of the separator.
const PANE_LEGEND_GAP_PX = 4;

// Volume and OBV compact ("1,2 M", with a plain space where Intl puts a non-breaking one).
function valueText(key: IndicatorKey, v: number, decimals: number) {
	if (COMPACT.includes(key)) return (v < 0 ? "−" : "") + compact.format(Math.abs(v)).replace(/\s/g, " ");
	return formatNumber(v, { decimals });
}

/** The point of a line at `at` (null: its last), or -1 where it has none (before its first value). */
function indexAt(line: IndicatorLine, at: number | null) {
	if (at === null) return line.data.length - 1;
	const i = line.data.findLastIndex((p) => p.time <= at);
	return i >= 0 && line.data[i].time === at ? i : -1;
}

/** One value per visible line, in its color; a histogram's in the candles' colors (or the ones saved) by its bar. */
function valuesAt(key: IndicatorKey, lines: IndicatorLine[], style: IndicatorStyle | undefined, at: number | null) {
	const points = lines.map((line) => indexAt(line, at));
	// One precision per indicator, its first value's: MACD's histogram near zero reads like its line.
	const first = points.findIndex((i) => i >= 0);
	const decimals = ONE_DECIMAL.includes(key) ? 1 : priceDecimals(first < 0 ? 0 : lines[first].data[points[first]].value);
	return lines.flatMap((line, n) => {
		const saved = style?.lines?.[line.id];
		const look = lineLook(line, saved);
		if (!look.visible) return [];
		const i = points[n];
		const color = line.type !== "histogram" ? look.color : line.up?.[i] === false ? (saved?.downColor ?? CANDLE_COLORS.down) : (saved?.upColor ?? CANDLE_COLORS.up);
		return [{ id: line.id, label: LABELS[line.id], text: i < 0 ? "—" : valueText(key, line.data[i].value, decimals), color }];
	});
}

function Action({ label, title, onClick, children }: { label: string; title: string; onClick: () => void; children: React.ReactNode }) {
	return (
		<button type="button" aria-label={label} title={title} onClick={onClick} className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink max-[819px]:h-8 max-[819px]:w-8">
			{children}
		</button>
	);
}

function LegendRow({ k, name, swatch, values, own, touching }: { k: IndicatorKey; name: string; swatch?: string; values: ReturnType<typeof valuesAt>; own: boolean; touching: boolean }) {
	const hidden = useChartStore((s) => s.hidden[k]);
	const minimized = useChartStore((s) => own && s.minimized[k]);
	const toggleHidden = useChartStore((s) => s.toggleHidden);
	const toggleMinimized = useChartStore((s) => s.toggleMinimized);
	const removeIndicator = useChartStore((s) => s.removeIndicator);
	const setSettingsTarget = useChartStore((s) => s.setSettingsTarget);
	// A tap shows the actions: a phone has no hover.
	const [open, setOpen] = useState(false);
	const icon = "h-3.5 w-3.5";
	return (
		<div data-row className={cn("group pointer-events-auto flex w-fit max-w-full flex-wrap items-center gap-x-2 rounded bg-[color-mix(in_srgb,var(--bg)_80%,transparent)] px-1 text-ink-2", hidden && "opacity-50")}>
			<button
				type="button"
				aria-expanded={minimized ? undefined : open}
				title={minimized ? "Expandir" : undefined}
				onClick={() => (minimized ? toggleMinimized(k) : setOpen(!open))}
				className="inline-flex items-center gap-1.5 whitespace-nowrap rounded max-[819px]:min-h-7"
			>
				{swatch && <span aria-hidden className="h-0.5 w-2.5 rounded" style={{ background: swatch }} />}
				{name}
				{minimized && <span className="text-ink-3"> · minimizado</span>}
			</button>
			{!minimized && (
				<span data-values={k} className={cn("inline-flex flex-wrap gap-x-2 tabular-nums", !own && !touching && "max-[819px]:hidden")}>
					{values.map((v) => (
						<span key={v.id} className="whitespace-nowrap">
							{v.label && <span className="text-ink-3">{v.label} </span>}
							<span style={{ color: v.color }}>{v.text}</span>
						</span>
					))}
				</span>
			)}
			<span data-actions className={cn("items-center", open ? "inline-flex" : "hidden group-hover:inline-flex group-focus-within:inline-flex")}>
				{own && (
					<Action label={`${minimized ? "Expandir" : "Minimizar"} ${name}`} title={minimized ? "Expandir" : "Minimizar"} onClick={() => toggleMinimized(k)}>
						{minimized ? <ChevronRight className={icon} aria-hidden /> : <Minus className={icon} aria-hidden />}
					</Action>
				)}
				<Action label={`${hidden ? "Mostrar" : "Ocultar"} ${name}`} title={hidden ? "Mostrar" : "Ocultar"} onClick={() => toggleHidden(k)}>
					{hidden ? <EyeOff className={icon} aria-hidden /> : <Eye className={icon} aria-hidden />}
				</Action>
				<Action label={`Ajustes ${name}`} title="Ajustes" onClick={() => setSettingsTarget(k)}>
					<Settings2 className={icon} aria-hidden />
				</Action>
				<Action label={`Quitar ${name}`} title="Quitar" onClick={() => removeIndicator(k)}>
					<X className={icon} aria-hidden />
				</Action>
			</span>
		</div>
	);
}

export function PaneLegends({
	keys,
	lines,
	config,
	saved,
	at,
	tops,
	head,
	children,
}: {
	/** The indicators drawn, in INDICATOR_ORDER: the price pane's, then one pane each. */
	keys: IndicatorKey[];
	lines: Map<IndicatorKey, IndicatorLine[]>;
	config: IndicatorConfig;
	saved: ChartPreferences["indicatorSettings"];
	/** The bar under the crosshair; null: the last bar. */
	at: number | null;
	/** Where each pane starts, the price pane first; a pane not measured yet has none. */
	tops: number[];
	head: React.ReactNode;
	children: React.ReactNode;
}) {
	const row = (k: IndicatorKey, own: boolean) => {
		const l = lines.get(k) ?? [];
		const style = saved[k]?.style;
		return <LegendRow key={k} k={k} name={INDICATOR_SPECS[k].label(config)} swatch={own ? undefined : l[0] && lineLook(l[0], style?.lines?.[l[0].id]).color} values={valuesAt(k, l, style, at)} own={own} touching={at !== null} />;
	};
	const own = keys.filter((k) => INDICATOR_SPECS[k].pane === "own");
	return (
		<>
			{/* On a phone it flows in short rows: the candle data and the notes take a row each, the rest wraps. */}
			<div data-chart-legend className="pointer-events-none absolute left-3 top-2 z-10 flex max-w-[calc(100%-5rem)] flex-col items-start gap-1 text-[13px] max-[819px]:flex-row max-[819px]:flex-wrap max-[819px]:items-center max-[819px]:gap-x-1 max-[819px]:text-[12px]">
				{head}
				{keys.filter((k) => INDICATOR_SPECS[k].pane === "price").map((k) => row(k, false))}
				{children}
			</div>
			{own.map((k, i) => (
				<div
					key={k}
					data-pane-legend={k}
					className={cn("pointer-events-none absolute left-3 z-10 flex max-w-[calc(100%-5rem)] text-[12px]", tops[i + 1] === undefined && "invisible")}
					style={{ top: (tops[i + 1] ?? 0) + PANE_LEGEND_GAP_PX }}
				>
					{row(k, true)}
				</div>
			))}
		</>
	);
}
