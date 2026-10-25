"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
import { hitTestAlert, priceDecimals, type ChartAlert } from "@/lib/chart/alerts";
import { touchDrawing } from "@/lib/chart/touch-drawing";
import type { Candle, Timeframe } from "@/lib/binance/types";
import { cn, formatNumber } from "@/lib/utils";
import { useCandles } from "./useCandles";
import { useDrawings } from "./useDrawings";
import { useChartAlerts } from "./useChartAlerts";
import { useChartTheme, type ChartTheme } from "./useChartTheme";
import { DrawingTools } from "./DrawingTools";
import { DrawingActions } from "./DrawingActions";

const TZ = "America/Argentina/Buenos_Aires";
const INTRADAY: Timeframe[] = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h"];
const VISIBLE_BARS = 160;
const DRAG_THRESHOLD_PX = 3;
// A finger covers more than a mouse pointer: the same sizes as the drawings (scripts/patch-drawing-lib.mjs).
const TOUCH_HIT_PX = 14;
const TOUCH_DRAG_PX = 8;
const LEGEND_OPEN_MAX = 3;
const TEXT_EDITOR_PX = 224;
// The text editor stays inside the chart however narrow the screen or close to the edge the text is.
const editorLeft = (x: number, width: number) => Math.max(8, Math.min(x, width - TEXT_EDITOR_PX - 8));

const priceText = (p: number) => formatNumber(p, { decimals: priceDecimals(p) });
// An alert keeps the precision the price axis shows: 0,1235 for a coin, not 0,12.
const roundPrice = (p: number) => Number(p.toFixed(priceDecimals(p)));
const PHONE = "(max-width: 819px)";
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
	phone: boolean,
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
		// The price pane keeps most of the height however many panes there are; on a phone,
		// where height is scarce, at least two thirds of it.
		const panes = chart.panes();
		const price = phone ? Math.max(3, 2 * (panes.length - 1)) : Math.max(3, panes.length);
		panes.forEach((p, i) => p.setStretchFactor(i === 0 ? price : 1));
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

/** `phoneBar`: where the page wants the phone's drawing controls, in its bottom bar. */
export function TradingChart({ symbol, timeframe, phoneBar = null }: { symbol: string; timeframe: Timeframe; phoneBar?: HTMLElement | null }) {
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


	const theme = useChartTheme();
	const intraday = INTRADAY.includes(timeframe);
	const indicators = useChartStore((s) => s.indicators);
	const hidden = useChartStore((s) => s.hidden);
	const config = useChartStore((s) => s.config);
	const toggleHidden = useChartStore((s) => s.toggleHidden);
	const removeIndicator = useChartStore((s) => s.removeIndicator);
	const setSettingsTarget = useChartStore((s) => s.setSettingsTarget);
	const enabled = useMemo(() => INDICATOR_ORDER.filter((k) => indicators[k]), [indicators]);

	// The indicator list starts folded on phones, or when it is long enough to cover the candles.
	const legendLong = enabled.length > LEGEND_OPEN_MAX;
	useEffect(() => setLegendOpen(!legendLong && !window.matchMedia(PHONE).matches), [legendLong]);

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
		// A text drawing asks for its editor on the press that places it, but the chart blurs
		// whatever has the focus when a press starts (its touchstart and mousedown come after
		// that pointerdown). So the editor opens when the press ends: on touchend for a finger,
		// where iOS still lets a field take the focus and raise the keyboard, and with no
		// emulated mouse press after it to take the focus away again.
		let pressing: string | null = null;
		const onPress = (e: PointerEvent) => { pressing = e.pointerType; };
		const onRelease = () => { pressing = null; };
		box.addEventListener("pointerdown", onPress, true);
		window.addEventListener("pointerup", onRelease, true);
		const offText = drawings.on("textEdit", (drawing, screen) => {
			const open = () => flushSync(() => setTextEdit({ drawing, x: editorLeft(screen.x, box.clientWidth), y: screen.y }));
			if (pressing === "touch") {
				// A cancelled touch opens it too, and takes the touchend listener with it.
				const done = new AbortController();
				const opts = { once: true, passive: false, signal: done.signal };
				window.addEventListener("touchend", (e) => { e.preventDefault(); done.abort(); open(); }, opts);
				window.addEventListener("touchcancel", () => { done.abort(); open(); }, opts);
			} else if (pressing) window.addEventListener("pointerup", open, { once: true });
			else open();
		});
		const offTouch = touchDrawing(drawings, chart.chartElement());
		const onMove = (p: MouseEventParams) => setHover((p.seriesData.get(series) as Candle | undefined) ?? null);
		chart.subscribeCrosshairMove(onMove);
		chartRef.current = chart;
		seriesRef.current = series;
		setManager(drawings);
		return () => {
			offText();
			offTouch();
			box.removeEventListener("pointerdown", onPress, true);
			window.removeEventListener("pointerup", onRelease, true);
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
				// Scaling the price axis by hand turns auto scale off, and it would keep the last
				// ticker's price range: BTC's 80k with SPY's candles out of sight.
				series.priceScale().applyOptions({ autoScale: true });
			}
		}
		manager?.setInterval(timeframe);
	}, [data.status, data.candles, data.change, symbol, timeframe, manager]);

	// Indicators follow the candles and the store.
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart || !theme || data.status !== "ready") return;
		syncIndicators(chart, indicatorsRef.current, data.candles, enabled, hidden, config, theme, window.matchMedia(PHONE).matches);
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
				if (price !== null) create(roundPrice(price));
				return;
			}
			if (manager?.tool()) return;
			const touch = e.pointerType === "touch";
			const id = hitTestAlert(alerts, y, (p) => series.priceToCoordinate(p), touch ? TOUCH_HIT_PX : undefined);
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
				if (!dragged && Math.abs(yy - y) < (touch ? TOUCH_DRAG_PX : DRAG_THRESHOLD_PX)) return;
				dragged = true;
				const p = series.coordinateToPrice(yy);
				if (p === null) return;
				price = roundPrice(p);
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
		<div className="flex min-h-0 flex-1">
			<DrawingTools manager={manager} alertMode={alertMode} onAlertMode={setAlertMode} phoneBar={phoneBar} />
			<div className="relative min-h-0 min-w-0 flex-1">
				{/* touch-none: the chart pans and zooms itself; left to the browser, a finger drag on a
				    drawing or an alert is taken over as a page scroll and cancelled halfway. isolate: the
				    library's pane separators sit at z-index 50, above the phone's app menu, unless kept in
				    here; only there, as a computer's text rendering changes with it. */}
				<div ref={boxRef} data-chart-box className={cn("absolute inset-0 touch-none max-[819px]:isolate", alertMode && "cursor-crosshair")} />

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
					// A phone says it, with Cancelar, in its bottom bar; there is no Esc there.
					<p role="status" className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded bg-ink px-3 py-1.5 text-[13px] text-canvas shadow-[var(--shadow-toast)] max-[819px]:hidden">
						Tocá el gráfico en el precio de la alerta<span className="[@media(pointer:coarse)]:hidden"> · Esc para cancelar</span>
					</p>
				)}

				{selected && selectedAlert && (
					<div
						role="dialog"
						aria-label={selected.name}
						className="absolute right-20 z-20 flex items-center gap-2 rounded border border-line bg-surface px-3 py-2 text-[13px] shadow-[var(--shadow-pop)] max-[819px]:left-3 max-[819px]:right-auto"
						// Above the line and clear of it (the panel is up to ~62px with a wrapped
						// name), so the line can still be dragged; below it near the top.
						style={{ top: selectedAlert.y > 80 ? selectedAlert.y - 72 : selectedAlert.y + 16 }}
					>
						<span className="text-ink">{selected.name}</span>
						{selected.status === "triggered" && (
							<button type="button" onClick={() => rearm(selected.id)} className="rounded px-2 py-1 text-accent-ink hover:bg-accent-soft max-[819px]:min-h-11 max-[819px]:px-3">
								Reactivar
							</button>
						)}
						<button
							type="button"
							onClick={() => {
								remove(selected.id);
								setSelectedAlert(null);
							}}
							className="rounded px-2 py-1 text-danger hover:bg-danger-soft max-[819px]:min-h-11 max-[819px]:px-3"
						>
							Eliminar
						</button>
						<button type="button" aria-label="Cerrar" onClick={() => setSelectedAlert(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-3 hover:bg-hover max-[819px]:h-11 max-[819px]:w-11">
							<X className="h-3.5 w-3.5" aria-hidden />
						</button>
					</div>
				)}

				<DrawingActions manager={manager} onEditText={(drawing) => setTextEdit({ drawing, x: 12, y: 56 })} />

				{textEdit && (
					<input
						autoFocus
						aria-label="Texto del dibujo"
						defaultValue={textEdit.drawing.text ?? ""}
						className="absolute z-20 w-56 max-w-[calc(100%-16px)] rounded border border-line-strong bg-surface px-2 py-1 text-[13px] text-ink outline-none focus:border-ring"
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
					<div className="absolute inset-0 z-30 grid place-items-center bg-canvas text-[14px]">
						{data.status === "loading" ? (
							<p role="status" className="text-ink-3">Cargando {symbol}…</p>
						) : (
							<div role="alert" className="flex flex-col items-center gap-3 text-center">
								<p className="text-ink">No se pudo cargar {symbol}</p>
								<p className="max-w-sm text-[13px] text-ink-3">{data.error}</p>
								<button type="button" onClick={data.retry} className="rounded bg-primary px-3 py-1.5 text-primary-on hover:bg-primary-hover">
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
