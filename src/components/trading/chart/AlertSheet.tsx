"use client";

import { useState } from "react";
import type { IndicatorConfig } from "@/lib/store/chart-store";
import type { Timeframe } from "@/lib/binance/types";
import { cn } from "@/lib/utils";
import { EsNumberInput } from "@/components/ui/es-number-input";
import { field, ghostButton, primaryButton } from "@/components/trading/ui";
import { ALERT_LINES, indicatorsOf, type AlertOperator } from "@/lib/chart/alert-condition";
import { indicatorValues } from "@/lib/chart/indicator-style";
import { lineLabel, priceDecimals, restate, timeframeLabel, type ChartAlert } from "@/lib/chart/alerts";
import type { AlertDraft } from "./useChartAlerts";
import { ChartSheet } from "./ChartSheet";
import { Swatches } from "./DrawingSettings";

const LINES = ["price", ...ALERT_LINES];
const WAYS: { value: AlertOperator; label: string }[] = [
	{ value: "crosses_above", label: "Cruza para arriba" },
	{ value: "crosses_below", label: "Para abajo" },
	{ value: "crosses", label: "Cualquiera" },
];
const STATUS_TEXT = { triggered: "Disparada: ya avisó y no vigila hasta que la reactives.", unavailable: "No se puede revisar: el servidor no pudo calcular esta condición." };

// The precision the chart's price axis shows (TradingChart's roundPrice).
const round = (v: number | null) => (v === null ? null : Number(v.toFixed(priceDecimals(v))));
const sectionClass = "border-b border-line py-2 last:border-b-0";
const headingClass = "pb-1 text-[12px] font-medium text-ink-3";

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
	return (
		<div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded bg-surface-2 p-0.5">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					role="radio"
					aria-checked={value === o.value}
					onClick={() => onChange(o.value)}
					className={cn("min-h-9 rounded px-2 text-[13px] leading-tight text-ink-2 hover:text-ink max-[819px]:min-h-11", value === o.value && "bg-surface font-medium text-ink shadow-sm")}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

/**
 * An alert's settings (odd/tasks/chart-customization.md S6): what crosses (the price or an indicator line), which
 * way, against what (a value typed by hand or another line), its color. A new alert starts from the last price,
 * either way. An indicator condition uses the chart's timeframe and periods when it is created and keeps them.
 * Nothing is sent until Guardar; Listo closes without saving.
 */
export function AlertSheet({
	open,
	onOpenChange,
	ticker,
	alert,
	timeframe,
	config,
	lastValue,
	onSave,
	onDelete,
	onRearm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	ticker: string;
	/** Absent: a new alert. */
	alert?: ChartAlert;
	/** The chart's timeframe and indicator values, for a condition created now. */
	timeframe: Timeframe;
	config: IndicatorConfig;
	/** A line's last value on the chart ('price' or one of ALERT_LINES). */
	lastValue: (line: string) => number | null;
	onSave: (draft: AlertDraft) => Promise<unknown> | void;
	onDelete?: () => void;
	onRearm?: () => void;
}) {
	const [draft, setDraft] = useState(() => ({
		source: alert?.source ?? "price",
		operator: alert?.operator ?? ("crosses" as AlertOperator),
		target: alert?.target ?? "value",
		value: alert ? alert.value : round(lastValue("price")),
		color: alert?.color ?? null,
	}));
	const [saving, setSaving] = useState(false);
	const set = (change: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...change }));

	// An alert keeps what it was created with; anything new comes from the chart as it is now.
	const periodsFrom = { ...config, ...alert?.periods };
	const indicators = indicatorsOf(draft);
	const tf = indicators.length ? (alert?.timeframe ?? timeframe) : null;
	const condition: AlertDraft = {
		...draft,
		value: draft.target === "value" ? draft.value : null,
		timeframe: tf,
		periods: indicators.length ? Object.assign({}, ...indicators.map((k) => indicatorValues(k, periodsFrom))) : null,
	};
	const valid = draft.target !== "value" || draft.value !== null;
	const others = LINES.filter((l) => l !== draft.source);
	const label = (line: string) => lineLabel(line, periodsFrom);

	const save = async () => {
		if (!valid || saving) return;
		setSaving(true);
		await onSave({ ...condition, value: round(condition.value) });
		setSaving(false);
	};

	return (
		<ChartSheet
			open={open}
			onOpenChange={onOpenChange}
			title={`${alert ? "Alerta" : "Nueva alerta"} · ${ticker}`}
			footer={
				<div className="flex flex-wrap items-center justify-between gap-2">
					{alert && onDelete ? (
						<button type="button" onClick={onDelete} className={cn(ghostButton, "text-danger hover:bg-danger-soft hover:text-danger")}>
							Borrar alerta
						</button>
					) : (
						<span />
					)}
					<button type="button" onClick={save} disabled={!valid || saving} className={primaryButton}>
						Guardar
					</button>
				</div>
			}
		>
			{alert && alert.status !== "active" && (
				<div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 text-[13px] text-ink-2">
					<p className={cn(alert.status === "unavailable" && "font-medium text-danger")}>{STATUS_TEXT[alert.status]}</p>
					{onRearm && (
						<button type="button" onClick={onRearm} className={cn(ghostButton, "text-accent-ink")}>
							Reactivar
						</button>
					)}
				</div>
			)}
			<section className={sectionClass}>
				<h3 className={headingClass}>Cuando</h3>
				<select
					aria-label="Cuando"
					value={draft.source}
					onChange={(e) => {
						const source = e.target.value;
						set({
							source,
							target: draft.target === source ? LINES.find((l) => l !== source)! : draft.target,
							// A value against a new line starts from that line's last value: 70 means nothing to the price.
							value: draft.target === "value" ? (round(lastValue(source)) ?? draft.value) : draft.value,
						});
					}}
					className={field}
				>
					{LINES.map((l) => (
						<option key={l} value={l}>{label(l)}</option>
					))}
				</select>
			</section>
			<section className={sectionClass}>
				<h3 className={headingClass}>Cruce</h3>
				<Segmented label="Cruce" value={draft.operator} options={WAYS} onChange={(operator) => set({ operator })} />
			</section>
			<section className={cn(sectionClass, "flex flex-col gap-2")}>
				<h3 className={cn(headingClass, "pb-0")}>Contra</h3>
				<Segmented
					label="Contra"
					value={draft.target === "value" ? "value" : "line"}
					options={[{ value: "value", label: "Un valor" }, { value: "line", label: "Otra línea" }]}
					onChange={(kind) =>
						set(kind === "value" ? { target: "value", value: draft.value ?? round(lastValue(draft.source)) } : { target: draft.target === "value" ? others[0] : draft.target })
					}
				/>
				{draft.target === "value" ? (
					<EsNumberInput aria-label="Valor" allowNegative value={draft.value} onValue={(value) => set({ value })} className={field} />
				) : (
					<select aria-label="Línea" value={draft.target} onChange={(e) => set({ target: e.target.value })} className={field}>
						{others.map((l) => (
							<option key={l} value={l}>{label(l)}</option>
						))}
					</select>
				)}
				{tf && (
					<p data-alert-note className="text-[13px] text-ink-3">
						Con velas de {timeframeLabel(tf)}, el intervalo del gráfico{alert?.timeframe && alert.timeframe !== timeframe ? " cuando la creaste" : ""}.
					</p>
				)}
			</section>
			<section className={sectionClass}>
				<h3 className={headingClass}>Color</h3>
				<Swatches label="Color de la alerta" value={draft.color ?? undefined} onPick={(color) => set({ color })} />
			</section>
			<p data-alert-sentence className="py-3 text-[14px] text-ink">
				{valid ? restate(ticker, { ...condition, value: round(condition.value) }) : "Escribí el valor de la alerta."}
			</p>
		</ChartSheet>
	);
}
