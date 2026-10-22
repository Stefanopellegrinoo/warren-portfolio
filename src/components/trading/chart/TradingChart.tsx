"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
	CandlestickSeries,
	CrosshairMode,
	HistogramSeries,
	LineSeries,
	LineStyle,
	TickMarkType,
	createChart,
	type IChartApi,
	type IPriceLine,
	type ISeriesApi,
	type MouseEventParams,
	type SeriesType,
	type Time,
	type UTCTimestamp,
} from "lightweight-charts";
import { DrawingManager, type Drawing } from "lightweight-charts-drawing";
import { ChevronDown, Eye, EyeOff, Settings2, X } from "lucide-react";
import { useChartStore, type IndicatorKey } from "@/lib/store/chart-store";
import { INDICATOR_ORDER, INDICATOR_SPECS } from "@/lib/chart/indicator-specs";
import { hitTestAlert, type ChartAlert } from "@/lib/chart/alerts";
import type { Candle, Timeframe } from "@/lib/binance/types";
import { cn, formatNumber } from "@/lib/utils";
import { useCandles } from "./useCandles";
import { useDrawings } from "./useDrawings";
import { useChartAlerts } from "./useChartAlerts";
import { useChartTheme, type ChartTheme } from "./useChartTheme";
import { DrawingTools } from "./DrawingTools";

const TZ = "America/Argentina/Buenos_Aires";
const INTRADAY: Timeframe[] = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h"];
const VISIBLE_BARS = 160;
const DRAG_THRESHOLD_PX = 3;

const priceText = (p: number) => formatNumber(p, { decimals: Math.abs(p) < 1 ? 4 : 2 });
const asTime = (t: number) => t as UTCTimestamp;
const PRICE_FORMAT = { type: "custom" as const, formatter: priceText, minMove: 0.0001 };

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-AR", { timeZone: TZ, ...opts });
const DAY = fmt({ day: "numeric", month: "short", year: "numeric" });
const DAY_TIME = fmt({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const TICK = {
	[TickMarkType.Year]: fmt({ year: "numeric" }),
	[TickMarkType.Month]: fmt({ month: "short" }),
	[TickMarkType.DayOfMonth]: fmt({ day: "numeric", month: "short" }),
	[TickMarkType.Time]: fmt({ hour: "2-digit", minute: "2-digit" }),
	[TickMarkType.TimeWithSeconds]: fmt({ hour: "2-digit", minute: "2-digit", second: "2-digit" }),
};

function chartOptions(t: ChartTheme, intraday: boolean) {
	return {
		layout: {
			background: { color: t.bg },
			textColor: t.ink3,
			fontFamily: t.font,
			fontSize: 12,
			attributionLogo: true,
			panes: { separatorColor: t.line, separatorHoverColor: t.lineStrong },
		},
		grid: { vertLines: { color: t.line }, horzLines: { color: t.line } },
		crosshair: {
			mode: CrosshairMode.Normal,
			vertLine: { color: t.lineStrong, labelBackgroundColor: t.ink2 },
			horzLine: { color: t.lineStrong, labelBackgroundColor: t.ink2 },
		},
		rightPriceScale: { borderColor: t.line },
		timeScale: { borderColor: t.line, timeVisible: intraday, rightOffset: 6 },
		localization: {
			locale: "es-AR",
			timeFormatter: (time: Time) => (intraday ? DAY_TIME : DAY).format(new Date((time as number) * 1000)),
		},
	};
}

interface IndicatorSeries {
	key: IndicatorKey;
	series: ISeriesApi<SeriesType>[];
}

/** Rebuilds the indicator series when the enabled set or a setting changes,
 *  then feeds every series the current candles. */
function syncIndicators(
	chart: IChartApi,
	built: { signature: string; list: IndicatorSeries[] },
	candles: Candle[],
	enabled: IndicatorKey[],
	hidden: Record<IndicatorKey, boolean>,
	config: Parameters<(typeof INDICATOR_SPECS)["ema20"]["lines"]>[1],
	theme: ChartTheme,
) {
	const signature = JSON.stringify([enabled, config, theme.ink3]);
	if (built.signature !== signature) {
		built.list.forEach(({ series }) => series.forEach((s) => chart.removeSeries(s)));
		let pane = 0;
		built.list = enabled.map((key) => {
			const spec = INDICATOR_SPECS[key];
			const paneIndex = spec.pane === "own" ? ++pane : 0;
			const series = spec.lines(candles, config).map((l) =>
				l.type === "histogram"
					? chart.addSeries(
							HistogramSeries,
							{ color: l.color, priceLineVisible: false, lastValueVisible: false, priceFormat: key === "volume" ? { type: "volume" } : PRICE_FORMAT },
							paneIndex,
						)
					: chart.addSeries(
							LineSeries,
							{ color: l.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: PRICE_FORMAT },
							paneIndex,
						),
			);
			spec.levels?.forEach((price) =>
				series[0].createPriceLine({ price, color: theme.ink3, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false }),
			);
			return { key, series };
		});
		// The price pane keeps most of the height however many panes there are.
		const panes = chart.panes();
		panes.forEach((p, i) => p.setStretchFactor(i === 0 ? Math.max(3, panes.length) : 1));
		built.signature = signature;
	}
	for (const { key, series } of built.list) {
		const lines = INDICATOR_SPECS[key].lines(candles, config);
		series.forEach((s, i) => {
			s.setData(lines[i].data.map((p) => ({ time: asTime(p.time), value: p.value })));
			s.applyOptions({ visible: !hidden[key] });
		});
	}
}

export function TradingChart({ symbol, timeframe }: { symbol: string; timeframe: Timeframe }) {
	const boxRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
	const indicatorsRef = useRef<{ signature: string; list: IndicatorSeries[] }>({ signature: "", list: [] });
	const alertLinesRef = useRef(new Map<string, IPriceLine>());
	const fittedRef = useRef("");
	const [manager, setManager] = useState<DrawingManager | null>(null);
	const [hover, setHover] = useState<Candle | null>(null);
	const [alertMode, setAlertMode] = useState(false);
	const [selectedAlert, setSelectedAlert] = useState<{ id: string; y: number } | null>(null);
	const [textEdit, setTextEdit] = useState<{ drawing: Drawing; x: number; y: number } | null>(null);
	const [legendOpen, setLegendOpen] = useState(true);

	// Phones start with the indicator list folded: it would cover the candles.
	useEffect(() => setLegendOpen(!window.matchMedia("(max-width: 819px)").matches), []);

	const theme = useChartTheme();
	const intraday = INTRADAY.includes(timeframe);
	const indicators = useChartStore((s) => s.indicators);
	const hidden = useChartStore((s) => s.hidden);
	const config = useChartStore((s) => s.config);
	const toggleHidden = useChartStore((s) => s.toggleHidden);
	const removeIndicator = useChartStore((s) => s.removeIndicator);
	const setSettingsTarget = useChartStore((s) => s.setSettingsTarget);
	const enabled = useMemo(() => INDICATOR_ORDER.filter((k) => indicators[k]), [indicators]);

	const data = useCandles(symbol, timeframe);
	const last = data.candles.at(-1) ?? null;
	const drawingsStatus = useDrawings(manager, symbol);
	const { alerts, create, move, rearm, remove } = useChartAlerts(symbol, last?.close ?? null);

	// The chart, its candle series and the drawing layer: created once.
	const ready = theme !== null;
	useEffect(() => {
		const box = boxRef.current;
		if (!ready || !box) return;
		const chart = createChart(box, { autoSize: true });
		const series = chart.addSeries(CandlestickSeries, { priceLineVisible: true, priceFormat: PRICE_FORMAT });
		const drawings = new DrawingManager(chart, series, { magnet: "off" });
		const offText = drawings.on("textEdit", (drawing, screen) => setTextEdit({ drawing, x: screen.x, y: screen.y }));
		const onMove = (p: MouseEventParams) => setHover((p.seriesData.get(series) as Candle | undefined) ?? null);
		chart.subscribeCrosshairMove(onMove);
		chartRef.current = chart;
		seriesRef.current = series;
		setManager(drawings);
		return () => {
			offText();
			chart.unsubscribeCrosshairMove(onMove);
			drawings.destroy();
			chart.remove();
			chartRef.current = null;
			seriesRef.current = null;
			indicatorsRef.current = { signature: "", list: [] };
			alertLinesRef.current.clear();
			setManager(null);
		};
	}, [ready]);

	// Theme and timeframe options.
	useEffect(() => {
		if (!theme || !chartRef.current || !seriesRef.current) return;
		chartRef.current.applyOptions(chartOptions(theme, intraday));
		seriesRef.current.applyOptions({
			upColor: theme.up,
			downColor: theme.down,
			borderUpColor: theme.up,
			borderDownColor: theme.down,
			wickUpColor: theme.up,
			wickDownColor: theme.down,
		});
	}, [theme, intraday, manager]);

	// Candles: a full redraw on load, series.update() for live bars.
	useEffect(() => {
		const series = seriesRef.current;
		const chart = chartRef.current;
		if (!series || !chart || data.status !== "ready") return;
		if (data.change.kind === "update") {
			data.change.bars.forEach((b) => series.update({ ...b, time: asTime(b.time) }));
		} else {
			series.setData(data.candles.map((c) => ({ ...c, time: asTime(c.time) })));
			const key = `${symbol}:${timeframe}`;
			if (fittedRef.current !== key) {
				fittedRef.current = key;
				const n = data.candles.length;
				chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - VISIBLE_BARS), to: n + 5 });
			}
		}
		manager?.setInterval(timeframe);
	}, [data.status, data.candles, data.change, symbol, timeframe, manager]);

	// Indicators follow the candles and the store.
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart || !theme || data.status !== "ready") return;
		syncIndicators(chart, indicatorsRef.current, data.candles, enabled, hidden, config, theme);
	}, [data.status, data.candles, enabled, hidden, config, theme, manager]);

	// Alert lines.
	useEffect(() => {
		const series = seriesRef.current;
		if (!series || !theme) return;
		alertLinesRef.current.forEach((l) => series.removePriceLine(l));
		alertLinesRef.current.clear();
		for (const a of alerts) {
			alertLinesRef.current.set(
				a.id,
				series.createPriceLine({
					price: a.value,
					color: a.status === "active" ? theme.accent : theme.ink3,
					lineStyle: a.status === "active" ? LineStyle.Solid : LineStyle.Dashed,
					lineWidth: 1,
					axisLabelVisible: true,
					title: a.status === "active" ? "Alerta" : "Disparada",
				}),
			);
		}
	}, [alerts, theme, manager]);

	// Alert placement and dragging. Capture phase: an alert under the pointer
	// wins over the drawing layer and the chart's own panning.
	useEffect(() => {
		const box = boxRef.current;
		const chart = chartRef.current;
		const series = seriesRef.current;
		if (!box || !chart || !series) return;

		const onDown = (e: PointerEvent) => {
			const y = e.clientY - box.getBoundingClientRect().top;
			if (alertMode) {
				const price = series.coordinateToPrice(y);
				e.stopPropagation();
				setAlertMode(false);
				if (price !== null) create(Math.round(price * 100) / 100);
				return;
			}
			if (manager?.tool()) return;
			const id = hitTestAlert(alerts, y, (p) => series.priceToCoordinate(p));
			if (!id) {
				setSelectedAlert(null);
				return;
			}
			e.stopPropagation();
			e.preventDefault();
			const line = alertLinesRef.current.get(id);
			const original = alerts.find((a) => a.id === id)!.value;
			let price = original;
			let dragged = false;
			chart.applyOptions({ handleScroll: false, handleScale: false });
			const onMovePtr = (ev: PointerEvent) => {
				const yy = ev.clientY - box.getBoundingClientRect().top;
				if (!dragged && Math.abs(yy - y) < DRAG_THRESHOLD_PX) return;
				dragged = true;
				const p = series.coordinateToPrice(yy);
				if (p === null) return;
				price = Math.round(p * 100) / 100;
				line?.applyOptions({ price });
			};
			const onUp = async () => {
				window.removeEventListener("pointermove", onMovePtr);
				window.removeEventListener("pointerup", onUp);
				chart.applyOptions({ handleScroll: true, handleScale: true });
				if (!dragged) {
					setSelectedAlert({ id, y });
					return;
				}
				if (!(await move(id, price))) line?.applyOptions({ price: original });
			};
			window.addEventListener("pointermove", onMovePtr);
			window.addEventListener("pointerup", onUp);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setAlertMode(false);
				setSelectedAlert(null);
			}
		};
		box.addEventListener("pointerdown", onDown, true);
		window.addEventListener("keydown", onKey);
		return () => {
			box.removeEventListener("pointerdown", onDown, true);
			window.removeEventListener("keydown", onKey);
		};
	}, [alertMode, alerts, create, move, manager]);

	useEffect(() => setSelectedAlert(null), [symbol]);

	const shown = hover ?? last;
	const prevClose = data.candles.at(-2)?.close;
	const change = shown && prevClose && shown === last ? (shown.close - prevClose) / prevClose : shown ? (shown.close - shown.open) / shown.open : null;
	const selected: ChartAlert | undefined = selectedAlert ? alerts.find((a) => a.id === selectedAlert.id) : undefined;

	return (
		<div className="flex min-h-0 flex-1 max-[819px]:flex-col">
			<DrawingTools manager={manager} alertMode={alertMode} onAlertMode={setAlertMode} />
			<div className="relative min-h-0 min-w-0 flex-1">
				<div ref={boxRef} className={cn("absolute inset-0", alertMode && "cursor-crosshair")} />

				<div className="pointer-events-none absolute left-3 top-2 z-10 flex max-w-[calc(100%-5rem)] flex-col gap-1 text-[13px]">
					<div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 tabular-nums">
						{shown && (
							<>
								<span className="text-ink-3">Ap <span className="text-ink">{priceText(shown.open)}</span></span>
								<span className="text-ink-3">Máx <span className="text-ink">{priceText(shown.high)}</span></span>
								<span className="text-ink-3">Mín <span className="text-ink">{priceText(shown.low)}</span></span>
								<span className="text-ink-3">Cie <span className="text-ink">{priceText(shown.close)}</span></span>
								{change !== null && Number.isFinite(change) && (
									<span className={change >= 0 ? "text-ok" : "text-danger"}>{formatNumber(change * 100, { sign: true })} %</span>
								)}
							</>
						)}
					</div>
					{enabled.length > 0 && (
						<button
							type="button"
							aria-expanded={legendOpen}
							onClick={() => setLegendOpen(!legendOpen)}
							className="pointer-events-auto inline-flex w-fit items-center gap-1 rounded px-1 text-ink-3 hover:bg-hover hover:text-ink max-[819px]:min-h-8"
						>
							<ChevronDown className={cn("h-3.5 w-3.5 transition-transform motion-reduce:transition-none", !legendOpen && "-rotate-90")} aria-hidden />
							{enabled.length === 1 ? "1 indicador" : `${enabled.length} indicadores`}
						</button>
					)}
					{legendOpen && enabled.map((key) => (
						<div key={key} className="pointer-events-auto flex items-center gap-1 text-ink-2">
							<span className={cn(hidden[key] && "text-ink-3 line-through")}>{INDICATOR_SPECS[key].label(config)}</span>
							<button type="button" aria-label={hidden[key] ? "Mostrar" : "Ocultar"} title={hidden[key] ? "Mostrar" : "Ocultar"} onClick={() => toggleHidden(key)} className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink max-[819px]:h-8 max-[819px]:w-8">
								{hidden[key] ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
							</button>
							<button type="button" aria-label="Configurar" title="Configurar" onClick={() => setSettingsTarget(key)} className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink max-[819px]:h-8 max-[819px]:w-8">
								<Settings2 className="h-3.5 w-3.5" aria-hidden />
							</button>
							<button type="button" aria-label="Quitar" title="Quitar" onClick={() => removeIndicator(key)} className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink max-[819px]:h-8 max-[819px]:w-8">
								<X className="h-3.5 w-3.5" aria-hidden />
							</button>
						</div>
					))}
				</div>

				{alertMode && (
					<p role="status" className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded bg-ink px-3 py-1.5 text-[13px] text-bg shadow-[var(--shadow-toast)]">
						Tocá el gráfico en el precio de la alerta · Esc para cancelar
					</p>
				)}

				{selected && selectedAlert && (
					<div
						role="dialog"
						aria-label={selected.name}
						className="absolute right-20 z-20 flex items-center gap-2 rounded border border-line bg-surface px-3 py-2 text-[13px] shadow-[var(--shadow-pop)] max-[819px]:left-3 max-[819px]:right-auto"
						style={{ top: Math.max(8, selectedAlert.y - 48) }}
					>
						<span className="text-ink">{selected.name}</span>
						{selected.status === "triggered" && (
							<button type="button" onClick={() => rearm(selected.id)} className="rounded px-2 py-1 text-accent-ink hover:bg-accent-soft">
								Reactivar
							</button>
						)}
						<button
							type="button"
							onClick={() => {
								remove(selected.id);
								setSelectedAlert(null);
							}}
							className="rounded px-2 py-1 text-danger hover:bg-danger-soft"
						>
							Eliminar
						</button>
						<button type="button" aria-label="Cerrar" onClick={() => setSelectedAlert(null)} className="grid h-7 w-7 place-items-center rounded text-ink-3 hover:bg-hover">
							<X className="h-3.5 w-3.5" aria-hidden />
						</button>
					</div>
				)}

				{textEdit && (
					<input
						autoFocus
						aria-label="Texto del dibujo"
						defaultValue={textEdit.drawing.text ?? ""}
						className="absolute z-20 w-56 rounded border border-line-strong bg-surface px-2 py-1 text-[13px] text-ink outline-none focus:border-ring"
						style={{ left: textEdit.x, top: textEdit.y }}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								manager?.update({ ...textEdit.drawing, text: e.currentTarget.value });
								setTextEdit(null);
							} else if (e.key === "Escape") setTextEdit(null);
						}}
						onBlur={(e) => {
							manager?.update({ ...textEdit.drawing, text: e.currentTarget.value });
							setTextEdit(null);
						}}
					/>
				)}

				{data.status !== "ready" && (
					<div className="absolute inset-0 z-30 grid place-items-center bg-bg/80 text-[14px]">
						{data.status === "loading" ? (
							<p role="status" className="text-ink-3">Cargando {symbol}…</p>
						) : (
							<div role="alert" className="flex flex-col items-center gap-3 text-center">
								<p className="text-ink">No se pudo cargar {symbol}</p>
								<p className="max-w-sm text-[13px] text-ink-3">{data.error}</p>
								<button type="button" onClick={data.retry} className="rounded bg-primary px-3 py-1.5 text-on-primary hover:bg-primary-hover">
									Reintentar
								</button>
							</div>
						)}
					</div>
				)}
				{data.status === "ready" && data.candles.length === 0 && (
					<p role="status" className="absolute inset-0 grid place-items-center text-ink-3">Sin datos para {symbol} en este período</p>
				)}
				{drawingsStatus === "error" && (
					<p role="alert" className="absolute bottom-3 right-20 z-10 rounded bg-danger-soft px-3 py-1.5 text-[13px] text-danger">
						Dibujos sin guardar: falló la carga
					</p>
				)}
			</div>
		</div>
	);
}
