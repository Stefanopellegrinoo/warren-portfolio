"use client";

import { useState } from "react";
import type { Drawing, DrawingStyle } from "lightweight-charts-drawing";
import { cn } from "@/lib/utils";
import { field, ghostButton } from "@/components/trading/ui";
import { DEFAULT_CONFIG, useChartStore, type IndicatorConfig, type IndicatorKey } from "@/lib/store/chart-store";
import { INDICATOR_SPECS } from "@/lib/chart/indicator-specs";
import { effectiveConfig, fillLook, indicatorValues, levelLooks, lineLook, type LineLook } from "@/lib/chart/indicator-style";
import { getPreferences, setIndicatorSettings } from "@/lib/chart/preferences";
import {
	INDICATOR_STYLE_PARTS,
	INDICATOR_VALUE_BOUNDS,
	type IndicatorFillStyle,
	type IndicatorLevelStyle,
	type IndicatorLineStyle,
	type IndicatorStyle,
} from "@/lib/chart/preferences-schema";
import { WIDTHS } from "@/lib/chart/drawing-options";
import { ChartSheet } from "./ChartSheet";
import { FillControls, Swatches } from "./DrawingSettings";
import { useChartPreferences } from "./useChartPreferences";

const VALUE_LABELS: Record<keyof IndicatorConfig, string> = {
	ema20: "Período",
	ema50: "Período",
	ema200: "Período",
	rsi: "Período",
	macdFast: "Rápida",
	macdSlow: "Lenta",
	macdSignal: "Señal",
	bbPeriod: "Período",
	bbStdDev: "Desv. estándar",
	stochK: "K",
	stochSmooth: "Suavizado",
	stochD: "D",
	adxPeriod: "Período",
};
const COLUMNS = ["", "grid-cols-1", "grid-cols-2", "grid-cols-3"];
// By the ids of INDICATOR_SPECS; an EMA's one line is "Línea".
const PART_NAMES: Record<string, string> = {
	upper: "Banda superior",
	middle: "Media",
	lower: "Banda inferior",
	rsi: "RSI",
	macd: "MACD",
	signal: "Señal",
	histogram: "Histograma",
	volume: "Barras",
	k: "%K",
	d: "%D",
	adx: "ADX",
	plusDI: "+DI",
	minusDI: "−DI",
	obv: "OBV",
	bands: "Fondo entre bandas",
	levels: "Fondo entre niveles",
};
// In the order of INDICATOR_SPECS' levels (RSI: 30, 70); the sheet lists the upper one first.
const LEVEL_NAMES = ["Nivel inferior", "Nivel superior"];

const rowClass = "flex min-h-9 cursor-pointer items-center gap-2 text-[14px] text-ink max-[819px]:min-h-11";
const captionClass = "pt-1 text-[13px] text-ink-2";
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** The chart's values (this device's under the account's) and the indicator's saved style, read now. */
function current(key: IndicatorKey) {
	const saved = getPreferences().indicatorSettings;
	return { config: effectiveConfig(useChartStore.getState().config, saved), style: saved[key]?.style };
}

/**
 * Saves the indicator's settings to the account (odd/tasks/chart-customization.md S4): its values as the chart
 * uses them now with `values` on top, and its style after `restyle`. From then on they apply on every device.
 */
function save(key: IndicatorKey, values: Partial<IndicatorConfig>, restyle?: (style: IndicatorStyle) => IndicatorStyle) {
	const { config, style } = current(key);
	const next = restyle ? restyle(style ?? {}) : style;
	const all = { ...indicatorValues(key, config), ...values };
	setIndicatorSettings(key, { ...(Object.keys(all).length > 0 && { values: all }), ...(next && { style: next }) });
}

/** Every level in full, so a saved one keeps its place (RSI's lower one first). */
const withLevel = (key: IndicatorKey, style: IndicatorStyle, at: number, change: Partial<IndicatorLevelStyle>): IndicatorLevelStyle[] =>
	(INDICATOR_SPECS[key].levels ?? []).map((value, i) => ({ value, ...style.levels?.[i], ...(i === at && change) }));

/** What was typed: saved when it differs from what the chart shows, kept within today's limits. */
function saveTyped(key: IndicatorKey, draft: Record<string, string>) {
	const { config, style } = current(key);
	const values: Partial<IndicatorConfig> = {};
	for (const [f, [min, max]] of Object.entries(INDICATOR_VALUE_BOUNDS[key]) as [keyof IndicatorConfig, readonly [number, number]][]) {
		const n = parseInt(draft[f] ?? "", 10);
		if (!isNaN(n) && clamp(n, min, max) !== config[f]) values[f] = clamp(n, min, max);
	}
	const bounds = INDICATOR_STYLE_PARTS[key].levels;
	const moved = levelLooks(key, style, "").map((level, i) => {
		const n = parseFloat(draft[`level${i}`] ?? "");
		return bounds && !isNaN(n) && clamp(n, bounds.min, bounds.max) !== level.value ? clamp(n, bounds.min, bounds.max) : null;
	});
	const levelsMoved = moved.some((n) => n !== null);
	if (Object.keys(values).length === 0 && !levelsMoved) return;
	save(key, values, levelsMoved ? (s) => moved.reduce((acc, n, i) => (n === null ? acc : { ...acc, levels: withLevel(key, acc, i, { value: n }) }), s) : undefined);
}

/** "Volver al de fábrica": the account forgets the indicator and this device goes back to its factory values. */
function reset(key: IndicatorKey) {
	setIndicatorSettings(key, null);
	useChartStore.getState().setConfig(indicatorValues(key, DEFAULT_CONFIG));
}

/**
 * An indicator's settings (odd/tasks/chart-customization.md S5), from the ⚙ next to it in the legend: Valores
 * (its numbers) and Estilo (each line, its levels and fills). A style change applies and is saved at once, as a
 * drawing's; a typed number is saved on Enter, when its field loses the focus, or when the sheet closes in any
 * way, so closing never loses it.
 */
export function IndicatorSettingsDialog() {
	const target = useChartStore((s) => s.settingsTarget);
	const setTarget = useChartStore((s) => s.setSettingsTarget);
	const device = useChartStore((s) => s.config);
	const saved = useChartPreferences().preferences.indicatorSettings;
	const config = effectiveConfig(device, saved);
	const [draft, setDraft] = useState<Record<string, string>>({});

	const commit = () => {
		if (target) saveTyped(target, draft);
		setDraft({});
	};

	return (
		<ChartSheet
			open={target !== null}
			onOpenChange={(open) => {
				if (open) return;
				commit();
				setTarget(null);
			}}
			title={target ? INDICATOR_SPECS[target].label(config) : ""}
			footer={
				target && (
					<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
						<p className="text-[13px] text-ink-3">Se guarda en tu cuenta, igual en todos tus dispositivos.</p>
						<button
							type="button"
							onClick={() => {
								reset(target);
								setDraft({});
							}}
							className={ghostButton}
						>
							Volver al de fábrica
						</button>
					</div>
				)
			}
		>
			{target && (
				<Settings
					target={target}
					config={config}
					style={saved[target]?.style}
					draft={draft}
					onDraft={(name, value) => setDraft((d) => ({ ...d, [name]: value }))}
					onCommit={commit}
					onPreset={(values) => {
						save(target, values);
						setDraft({});
					}}
				/>
			)}
		</ChartSheet>
	);
}

function Settings({
	target,
	config,
	style,
	draft,
	onDraft,
	onCommit,
	onPreset,
}: {
	target: IndicatorKey;
	config: IndicatorConfig;
	style: IndicatorStyle | undefined;
	draft: Record<string, string>;
	onDraft: (name: string, value: string) => void;
	onCommit: () => void;
	onPreset: (values: Partial<IndicatorConfig>) => void;
}) {
	const fields = Object.entries(INDICATOR_VALUE_BOUNDS[target]) as [keyof IndicatorConfig, readonly [number, number]][];
	const lines = INDICATOR_SPECS[target].lines([], config);
	const parts = INDICATOR_STYLE_PARTS[target];
	// Only RSI's levels are editable; the stochastic's and ADX's stay as they are.
	const levels = parts.levels ? levelLooks(target, style, "") : [];
	const typing = (name: string) => ({
		onChange: (e: React.ChangeEvent<HTMLInputElement>) => onDraft(name, e.target.value),
		onBlur: onCommit,
		onKeyDown: (e: React.KeyboardEvent) => {
			if (e.key === "Enter") onCommit();
		},
	});
	const setLine = (id: string, change: IndicatorLineStyle) =>
		save(target, {}, (s) => ({ ...s, lines: { ...s.lines, [id]: { ...s.lines?.[id], ...change } } }));
	const setLevel = (i: number, change: Partial<IndicatorLevelStyle>) => save(target, {}, (s) => ({ ...s, levels: withLevel(target, s, i, change) }));
	const setFill = (id: string, change: IndicatorFillStyle) =>
		save(target, {}, (s) => ({ ...s, fills: { ...s.fills, [id]: { ...s.fills?.[id], ...change } } }));

	return (
		<>
			<section className="border-b border-line py-2">
				<h3 className="pb-1 text-[12px] font-medium text-ink-3">Valores</h3>
				{fields.length === 0 ? (
					<p className="text-[13px] text-ink-3">No tiene valores para configurar.</p>
				) : (
					<div className={cn("grid gap-2", COLUMNS[fields.length])}>
						{fields.map(([f, [min, max]]) => (
							<label key={f} className="flex flex-col gap-1">
								<span className="text-[13px] font-medium text-ink-2">{VALUE_LABELS[f]}</span>
								<input type="number" min={min} max={max} value={draft[f] ?? String(config[f])} {...typing(f)} className={field} />
							</label>
						))}
					</div>
				)}
				{target === "stochastic" && (
					<button type="button" onClick={() => onPreset({ stochK: 21, stochSmooth: 5, stochD: 5 })} className={cn(ghostButton, "mt-2")}>
						Largo plazo (21, 5, 5)
					</button>
				)}
			</section>
			<section className="py-2">
				<h3 className="pb-1 text-[12px] font-medium text-ink-3">Estilo</h3>
				{lines.map((line) => (
					<LinePart
						key={line.id}
						name={PART_NAMES[line.id] ?? "Línea"}
						look={lineLook(line, style?.lines?.[line.id])}
						bars={line.type === "histogram"}
						toggle={target !== "volume"}
						onChange={(change) => setLine(line.id, change)}
					/>
				))}
				{levels
					.map((level, i) => (
						<Part key={`level${i}`} name={LEVEL_NAMES[i]}>
							<div className="flex items-center gap-2">
								<Toggle label={LEVEL_NAMES[i]} checked={level.visible} onChange={(visible) => setLevel(i, { visible })} />
								<input
									type="number"
									aria-label={`Valor del ${LEVEL_NAMES[i].toLowerCase()}`}
									min={parts.levels?.min}
									max={parts.levels?.max}
									value={draft[`level${i}`] ?? String(level.value)}
									{...typing(`level${i}`)}
									className={cn(field, "ml-auto w-24")}
								/>
							</div>
							<Swatches label="Color" value={style?.levels?.[i]?.color} onPick={(color) => setLevel(i, { color })} />
						</Part>
					))
					.reverse()}
				{parts.fills?.map((id) => {
					const look = fillLook(id, style);
					// The same Fondo as a drawing's (S2): visible, color, transparency.
					const asDrawing = { kind: "rectangle", style: { fillBackground: look.visible, backgroundColor: look.color, transparency: look.transparency } } as unknown as Drawing;
					return (
						<Part key={id} name={PART_NAMES[id]}>
							<p className={captionClass}>{PART_NAMES[id]}</p>
							<FillControls
								drawing={asDrawing}
								onStyle={(p: Partial<DrawingStyle>) =>
									setFill(id, {
										...(p.fillBackground !== undefined && { visible: p.fillBackground }),
										...(p.backgroundColor && { color: p.backgroundColor }),
										...(p.transparency !== undefined && { transparency: p.transparency }),
									})
								}
							/>
						</Part>
					);
				})}
			</section>
		</>
	);
}

const Part = ({ name, children }: { name: string; children: React.ReactNode }) => (
	<div role="group" aria-label={name} className="flex flex-col gap-1 border-t border-line py-2 first-of-type:border-t-0">
		{children}
	</div>
);

function LinePart({ name, look, bars, toggle, onChange }: { name: string; look: LineLook; bars: boolean; toggle: boolean; onChange: (change: IndicatorLineStyle) => void }) {
	return (
		<Part name={name}>
			{toggle ? <Toggle label={name} checked={look.visible} onChange={(visible) => onChange({ visible })} /> : <p className={captionClass}>{name}</p>}
			{bars ? (
				<>
					<p className={captionClass}>Cuando sube</p>
					<Swatches label="Color cuando sube" value={look.upColor} onPick={(upColor) => onChange({ upColor })} />
					<p className={captionClass}>Cuando baja</p>
					<Swatches label="Color cuando baja" value={look.downColor} onPick={(downColor) => onChange({ downColor })} />
				</>
			) : (
				<>
					<Swatches label="Color" value={look.color} onPick={(color) => onChange({ color })} />
					<div className="flex gap-1">
						{WIDTHS.map((w) => (
							<button
								key={w}
								type="button"
								aria-label={`Grosor ${w}`}
								aria-pressed={look.width === w}
								onClick={() => onChange({ width: w })}
								className={cn("grid h-8 w-10 place-items-center rounded hover:bg-hover max-[819px]:h-11 max-[819px]:w-11", look.width === w && "bg-accent-soft")}
							>
								<span className="w-6 rounded-full bg-ink" style={{ height: w }} aria-hidden />
							</button>
						))}
					</div>
				</>
			)}
		</Part>
	);
}

// The look of a drawing's switches (DrawingSettings), which that file keeps to itself.
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
	return (
		<label className={rowClass}>
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]" />
			{label}
		</label>
	);
}
