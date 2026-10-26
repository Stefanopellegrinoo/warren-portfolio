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
	createSeriesMarkers,
	type IChartApi,
	type IPriceLine,
	type ISeriesMarkersPluginApi,
	type ISeriesApi,
	type MouseEventParams,
	type SeriesType,
	type Time,
	type UTCTimestamp,
} from "lightweight-charts";
import { DrawingManager, type Drawing } from "lightweight-charts-drawing";
import { ChevronDown, Eye, EyeOff, Settings2, X } from "lucide-react";
import { MAX_COMPARE, useChartStore, type IndicatorKey } from "@/lib/store/chart-store";
import { INDICATOR_ORDER, INDICATOR_SPECS, type IndicatorLine } from "@/lib/chart/indicator-specs";
import { BandFill, effectiveConfig, fillLook, levelLooks, lineLook, seriesPoints } from "@/lib/chart/indicator-style";
import { INDICATOR_STYLE_PARTS, type ChartPreferences } from "@/lib/chart/preferences-schema";
import { hitTestAlert, priceDecimals, type ChartAlert } from "@/lib/chart/alerts";
import { indicatorOf, isPriceValue, lineIdOf } from "@/lib/chart/alert-condition";
import { touchDrawing } from "@/lib/chart/touch-drawing";
import { onTap, selectBeforeMove } from "@/lib/chart/select-before-move";
import { applyRememberedStyles } from "@/lib/chart/remembered-style";
import { tradeMarkers } from "@/lib/chart/trade-markers";
import { PORTFOLIO_SERIES, isArsSymbol, seriesLabel } from "@/lib/compare-series";
import { COMPARE_RANGES, COMPARE_TIMEFRAMES, alignToBars, compareBase, pctFrom, scaleToBase, toUsdCandles } from "@/lib/chart/compare";
import type { Candle, Timeframe } from "@/lib/binance/types";
import { cn, formatNumber } from "@/lib/utils";
import { useCandles } from "./useCandles";
import { useDrawings } from "./useDrawings";
import { useChartAlerts } from "./useChartAlerts";
import { useChartTheme, type ChartTheme } from "./useChartTheme";
import { DrawingTools } from "./DrawingTools";
import { DrawingActions } from "./DrawingActions";
import { useChartPreferences } from "./useChartPreferences";
import { AlertSheet } from "./AlertSheet";
import { useTradeMarkers } from "./useTradeMarkers";
import { TradeCard, TradeSheet } from "./TradeMarkers";
import { useCompareSeries } from "./useCompareSeries";
import { CompareSheet } from "./CompareSheet";

const TZ = "America/Argentina/Buenos_Aires";
const INTRADAY: Timeframe[] = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h"];
const VISIBLE_BARS = 160;
const DRAG_THRESHOLD_PX = 3;
// A finger covers more than a mouse pointer: the same sizes as the drawings (scripts/patch-drawing-lib.mjs).
const TOUCH_HIT_PX = 14;
const TOUCH_DRAG_PX = 8;
// How far from an arrow's bar a tap still opens its card: a 44px finger target, a mouse's few px.
const TRADE_SLOP_PX = { touch: 22, mouse: 6 };
const LEGEND_OPEN_MAX = 3;
const TEXT_EDITOR_PX = 224;
// The text editor stays inside the chart however narrow the screen or close to the edge the text is.
const editorLeft = (x: number, width: number) => Math.max(8, Math.min(x, width - TEXT_EDITOR_PX - 8));

const priceText = (p: number) => formatNumber(p, { decimals: priceDecimals(p) });
// An alert keeps the precision the price axis shows: 0,1235 for a coin, not 0,12.
const roundPrice = (p: number) => Number(p.toFixed(priceDecimals(p)));
const PHONE = "(max-width: 819px)";
const asTime = (t: number) => t as UTCTimestamp;
/** What the main series draws of a bar: the candle, or for a line (Mi cartera) its close. */
// One color per compared asset, in the order they were chosen; apart from the candles' green and red.
const COMPARE_COLORS = ["#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
const NONE: string[] = [];
const NO_ALERTS: ChartAlert[] = [];
// A note over the chart: on its own background, so the lines under it never cross the words.
const legendNote = "w-fit rounded bg-canvas px-1 text-ink-3";
const pointOf = (line: boolean, c: Candle) => (line ? { time: asTime(c.time), value: c.close } : { ...c, time: asTime(c.time) });
const PRICE_FORMAT = { type: "custom" as const, formatter: priceText, minMove: 0.0001 };
/** While comparing, the price scale reads in % from the base day's close: every line starts there. */
const percentFormat = (base: number) => ({
	type: "custom" as const,
	formatter: (p: number) => `${formatNumber((p / base - 1) * 100, { sign: true })} %`,
	minMove: 0.0001,
});
const dayText = (time: number) => new Date(time * 1000).toLocaleDateString("es-AR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "2-digit" });
const ALERT_TITLES = { active: "Alerta", triggered: "Disparada", unavailable: "No se puede revisar" };

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
	levels: IPriceLine[];
	fills: BandFill[];
}

/** What a fill spans: Bollinger's two bands, or RSI's two levels. */
function fillEdges(id: string, lines: IndicatorLine[], levels: { value: number }[]) {
	if (id === "bands") return { top: lines.find((l) => l.id === "upper")!.data, bottom: lines.find((l) => l.id === "lower")!.data };
	return { top: levels[1].value, bottom: levels[0].value };
}

/** Rebuilds the indicator series when the enabled set or a setting changes, then feeds every
 *  series the current candles and its style (a style change restyles, it never rebuilds the panes). */
function syncIndicators(
	chart: IChartApi,
	built: { signature: string; list: IndicatorSeries[] },
	candles: Candle[],
	enabled: IndicatorKey[],
	hidden: Record<IndicatorKey, boolean>,
	config: Parameters<(typeof INDICATOR_SPECS)["ema20"]["lines"]>[1],
	saved: ChartPreferences["indicatorSettings"],
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
			const levels = (spec.levels ?? []).map((price) =>
				series[0].createPriceLine({ price, color: theme.ink3, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false }),
			);
			const fills = (INDICATOR_STYLE_PARTS[key].fills ?? []).map(() => {
				const fill = new BandFill();
				series[0].attachPrimitive(fill);
				return fill;
			});
			return { key, series, levels, fills };
		});
		// The price pane keeps most of the height however many panes there are; on a phone,
		// where height is scarce, at least two thirds of it.
		const panes = chart.panes();
		const price = phone ? Math.max(3, 2 * (panes.length - 1)) : Math.max(3, panes.length);
		panes.forEach((p, i) => p.setStretchFactor(i === 0 ? price : 1));
		built.signature = signature;
	}
	for (const { key, series, levels, fills } of built.list) {
		const lines = INDICATOR_SPECS[key].lines(candles, config);
		const style = saved[key]?.style;
		series.forEach((s, i) => {
			const look = lineLook(lines[i], style?.lines?.[lines[i].id]);
			s.setData(seriesPoints(lines[i], look).map((p) => ({ ...p, time: asTime(p.time) })));
			const visible = !hidden[key] && look.visible;
			s.applyOptions(lines[i].type === "histogram" ? { visible, color: look.upColor } : { visible, color: look.color, lineWidth: look.width });
		});
		const looks = levelLooks(key, style, theme.ink3);
		levels.forEach((l, i) => l.applyOptions({ price: looks[i].value, color: looks[i].color, lineVisible: looks[i].visible }));
		fills.forEach((f, i) => {
			const id = INDICATOR_STYLE_PARTS[key].fills![i];
			const look = fillLook(id, style);
			f.update({ ...look, visible: look.visible && !hidden[key], ...fillEdges(id, lines, looks) });
		});
	}
}

/** `phoneBar`: where the page wants the phone's drawing controls, in its bottom bar. */
export function TradingChart({ symbol, timeframe, phoneBar = null }: { symbol: string; timeframe: Timeframe; phoneBar?: HTMLElement | null }) {
	const boxRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<IChartApi | null>(null);
	// Candles, or a line for Mi cartera, which has one value a day and no open, high or low.
	const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
	const indicatorsRef = useRef<{ signature: string; list: IndicatorSeries[] }>({ signature: "", list: [] });
	const alertLinesRef = useRef(new Map<string, IPriceLine>());
	const fittedRef = useRef("");
	const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
	// The last press on the chart: whether something took it (an armed tool, the alert placement,
	// an alert line), for the click the chart reports after it.
	const pressRef = useRef({ taken: false, touch: false });
	const [manager, setManager] = useState<DrawingManager | null>(null);
	const [hover, setHover] = useState<Candle | null>(null);
	const [alertMode, setAlertMode] = useState(false);
	const [selectedAlert, setSelectedAlert] = useState<{ id: string; y: number } | null>(null);
	// The alert sheet (S6): a new alert (id null) or an existing one.
	const [sheet, setSheet] = useState<{ id: string | null } | null>(null);
	// The operations card of a bar with arrows: its bar and where it was tapped.
	const [tradeCard, setTradeCard] = useState<{ chart: string; time: number; x: number; y: number; above: boolean; phone: boolean } | null>(null);
	const [textEdit, setTextEdit] = useState<{ drawing: Drawing; x: number; y: number } | null>(null);
	const [legendOpen, setLegendOpen] = useState(true);
	// Where the favorites bar floats: over the chart, in its container (S3).
	const [area, setArea] = useState<HTMLDivElement | null>(null);

	const theme = useChartTheme();
	const intraday = INTRADAY.includes(timeframe);
	const line = symbol === PORTFOLIO_SERIES;
	const indicators = useChartStore((s) => s.indicators);
	const hidden = useChartStore((s) => s.hidden);
	const device = useChartStore((s) => s.config);
	// An indicator's settings saved in the account win over this device's values (S4).
	const saved = useChartPreferences().preferences.indicatorSettings;
	const config = useMemo(() => effectiveConfig(device, saved), [device, saved]);
	const toggleHidden = useChartStore((s) => s.toggleHidden);
	const removeIndicator = useChartStore((s) => s.removeIndicator);
	const setSettingsTarget = useChartStore((s) => s.setSettingsTarget);
	const showTrades = useChartStore((s) => s.showTrades);
	const enabled = useMemo(() => INDICATOR_ORDER.filter((k) => indicators[k]), [indicators]);

	// The indicator list starts folded on phones, or when it is long enough to cover the candles.
	const legendLong = enabled.length > LEGEND_OPEN_MAX;
	useEffect(() => setLegendOpen(!legendLong && !window.matchMedia(PHONE).matches), [legendLong]);

	const data = useCandles(symbol, timeframe);
	const last = data.candles.at(-1) ?? null;

	// Comparing (S3): the assets chosen, minus the chart itself, drawn on daily charts and up only.
	const compareSymbols = useChartStore((s) => s.compareSymbols);
	const setCompareSymbols = useChartStore((s) => s.setCompareSymbols);
	const others = useMemo(() => compareSymbols.filter((s) => s !== symbol), [compareSymbols, symbol]);
	const daily = COMPARE_TIMEFRAMES.includes(timeframe);
	const comparing = daily ? others : NONE;
	// Everything compared is in dollars: a peso chart too, while it is compared.
	const usd = comparing.length > 0 && isArsSymbol(symbol);
	const compared = useCompareSeries(comparing, usd);
	const drawn = useMemo(() => (usd && compared.ccl ? toUsdCandles(data.candles, compared.ccl) : data.candles), [usd, compared.ccl, data.candles]);
	const aligned = useMemo(() => {
		const times = drawn.map((c) => c.time);
		const out = new Map<string, { time: number; value: number }[]>();
		for (const s of comparing) {
			const r = compared.series[s];
			if (r && "points" in r) out.set(s, alignToBars(times, r.points));
		}
		return out;
	}, [comparing, compared.series, drawn]);
	// The day every line starts from, fixed by the range (never by the view): panning or zooming
	// never changes a number.
	const compareRange = useChartStore((s) => s.compareRange);
	const setCompareRange = useChartStore((s) => s.setCompareRange);
	const base = useMemo(
		() => (comparing.length > 0 && aligned.size > 0 ? compareBase(drawn, [...aligned.values()], compareRange) : null),
		[comparing.length, aligned, drawn, compareRange],
	);
	// Mi cartera has no volume.
	const drawnIndicators = useMemo(() => enabled.filter((k) => !(line && k === "volume")), [enabled, line]);
	const compareLinesRef = useRef(new Map<string, ISeriesApi<"Line">>());
	const zoomedRef = useRef("");
	const drawnUsdRef = useRef(false);
	const [compareOpen, setCompareOpen] = useState(false);
	const drawingsStatus = useDrawings(manager, symbol);
	const trades = useTradeMarkers(symbol, data.candles, showTrades);
	const { alerts, create, save, move, rearm, remove } = useChartAlerts(symbol, last?.close ?? null);

	// The chart, its price series and the drawing layer: created once, and again when the series
	// changes between candles and a line.
	const ready = theme !== null;
	useEffect(() => {
		const box = boxRef.current;
		if (!ready || !box) return;
		const chart = createChart(box, { autoSize: true });
		const series = line
			? chart.addSeries(LineSeries, { priceLineVisible: true, lineWidth: 2, priceFormat: PRICE_FORMAT })
			: chart.addSeries(CandlestickSeries, { priceLineVisible: true, priceFormat: PRICE_FORMAT });
		markersRef.current = createSeriesMarkers(series, []);
		// Before the drawing layer, so a finger's press reaches it first (its events come later,
		// once `drawings` exists).
		const offSelect = selectBeforeMove(chart.chartElement(), () => drawings);
		// A new drawing comes out with the style last chosen for its tool (S2).
		const offStyles = applyRememberedStyles();
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
		const compareLines = compareLinesRef.current;
		const onMove = (p: MouseEventParams) => {
			const d = p.seriesData.get(series) as (Candle & { value?: number }) | undefined;
			// A line's point is one value: its legend reads it as a bar opening and closing there.
			setHover(d && d.value !== undefined ? { time: d.time as number, open: d.value, high: d.value, low: d.value, close: d.value, volume: 0 } : (d ?? null));
		};
		chart.subscribeCrosshairMove(onMove);
		chartRef.current = chart;
		seriesRef.current = series;
		setManager(drawings);
		return () => {
			offText();
			offTouch();
			offSelect();
			offStyles();
			box.removeEventListener("pointerdown", onPress, true);
			window.removeEventListener("pointerup", onRelease, true);
			chart.unsubscribeCrosshairMove(onMove);
			drawings.destroy();
			chart.remove();
			chartRef.current = null;
			seriesRef.current = null;
			markersRef.current = null;
			indicatorsRef.current = { signature: "", list: [] };
			alertLinesRef.current.clear();
			// The next chart gets every bar drawn and fitted again, with its own compared lines.
			fittedRef.current = "";
			compareLines.clear();
			zoomedRef.current = "";
			setManager(null);
		};
	}, [ready, line]);

	// Theme and timeframe options.
	useEffect(() => {
		if (!theme || !chartRef.current || !seriesRef.current) return;
		chartRef.current.applyOptions(chartOptions(theme, intraday));
		if (line) (seriesRef.current as ISeriesApi<"Line">).applyOptions({ color: theme.accent });
		else
			(seriesRef.current as ISeriesApi<"Candlestick">).applyOptions({
				upColor: theme.up,
				downColor: theme.down,
				borderUpColor: theme.up,
				borderDownColor: theme.down,
				wickUpColor: theme.up,
				wickDownColor: theme.down,
			});
	}, [theme, intraday, manager, line]);

	// Candles: a full redraw on load, series.update() for live bars.
	useEffect(() => {
		const series = seriesRef.current;
		const chart = chartRef.current;
		if (!series || !chart || data.status !== "ready") return;
		const key = `${symbol}:${timeframe}`;
		// Live bars on top of the bars already drawn; a new chart draws them all.
		const set = series as ISeriesApi<SeriesType>;
		if (data.change.kind === "update" && fittedRef.current === key && !usd && !drawnUsdRef.current) {
			data.change.bars.forEach((b) => set.update(pointOf(line, b)));
		} else {
			// A peso chart in dollars is redrawn whole: its live bars arrive in pesos.
			drawnUsdRef.current = usd;
			set.setData(drawn.map((c) => pointOf(line, c)));
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
	}, [data.status, data.candles, data.change, symbol, timeframe, manager, line, usd, drawn]);

	// The compared lines, drawn on the price scale from the chart's own close on the base day, so
	// every line starts at the same point and the indicators, drawings and alerts keep their prices.
	// The scale's labels read in % from that day while there is a base.
	useEffect(() => {
		const chart = chartRef.current;
		const main = seriesRef.current;
		if (!chart || !main) return;
		const lines = compareLinesRef.current;
		for (const [s, l] of lines) {
			if (base && aligned.has(s)) continue;
			chart.removeSeries(l);
			lines.delete(s);
		}
		const format = base ? percentFormat(base.close) : PRICE_FORMAT;
		main.applyOptions({ priceFormat: format });
		if (!base) return;
		for (const [s, points] of aligned) {
			let l = lines.get(s);
			if (!l) {
				l = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
				lines.set(s, l);
			}
			l.applyOptions({ color: COMPARE_COLORS[comparing.indexOf(s) % COMPARE_COLORS.length], priceFormat: format });
			l.setData(scaleToBase(points, base.time, base.close).map((p) => ({ time: asTime(p.time), value: p.value })));
		}
	}, [aligned, base, comparing, manager]);

	// A new range (or a comparison that starts) shows the range whole, from its first day on.
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart || !base) return;
		const key = `${symbol}:${timeframe}:${compareRange}`;
		if (zoomedRef.current === key) return;
		zoomedRef.current = key;
		chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, base.index - 1), to: drawn.length + 3 });
	}, [base, symbol, timeframe, compareRange, drawn.length, manager]);
	useEffect(() => {
		if (!base) zoomedRef.current = "";
	}, [base]);

	// The first time Mi cartera opens on this device, it opens against the market; after that, the
	// comparisons are whatever the user left.
	useEffect(() => {
		const state = useChartStore.getState();
		if (symbol !== PORTFOLIO_SERIES || state.compareDefaulted) return;
		useChartStore.setState({ compareDefaulted: true });
		if (state.compareSymbols.length === 0) setCompareSymbols(["SPY"]);
	}, [symbol, setCompareSymbols]);

	// A peso chart drawn in dollars: its drawings and alerts are in pesos, so they wait until the
	// comparison ends instead of landing in the wrong place or being saved in dollars.
	useEffect(() => {
		if (!manager || !usd) return;
		manager.setDrawingsVisible(false);
		return () => manager.setDrawingsVisible(true);
	}, [manager, usd]);
	const shownAlerts = usd ? NO_ALERTS : alerts;

	// The user's buys and sells, after the candles they sit on.
	useEffect(() => {
		markersRef.current?.setMarkers(theme ? tradeMarkers(trades, theme) : []);
	}, [trades, theme, manager]);

	// A click on (or, with a finger, near) a bar with arrows opens its operations, unless the press
	// was taken: an armed tool or alert placement, an alert line, a drawing it selected. Any other
	// click closes them.
	useEffect(() => {
		const chart = chartRef.current;
		const box = boxRef.current;
		if (!chart || !box || !manager) return;
		const onClick = (p: MouseEventParams) => {
			const press = pressRef.current;
			pressRef.current = { taken: false, touch: false };
			if (press.taken || manager.tool() !== null || manager.selection().length > 0 || !p.point || p.paneIndex !== 0) {
				setTradeCard(null);
				return;
			}
			const slop = press.touch ? TRADE_SLOP_PX.touch : TRADE_SLOP_PX.mouse;
			let best: { time: number; d: number } | null = null;
			for (const time of trades.keys()) {
				const x = chart.timeScale().timeToCoordinate(asTime(time));
				const d = x === null ? Infinity : Math.abs(x - p.point.x);
				if (d <= slop && (!best || d < best.d)) best = { time, d };
			}
			if (p.time !== undefined && trades.has(p.time as number)) best = { time: p.time as number, d: 0 };
			setTradeCard(best && { chart: `${symbol}:${timeframe}`, time: best.time, x: p.point.x, y: p.point.y, above: p.point.y > box.clientHeight / 2, phone: window.matchMedia(PHONE).matches });
		};
		chart.subscribeClick(onClick);
		return () => chart.unsubscribeClick(onClick);
	}, [manager, trades, symbol, timeframe]);

	// One thing selected or armed at a time (odd/tasks/chart-customization.md L16): arming a drawing
	// tool, from the strip, the list or the favorites bar (all through the layer), lets go of the
	// selected alert and the operations card; so does arming the alert placement, and the drawings too.
	useEffect(
		() =>
			manager?.on("tool", (kind) => {
				if (!kind) return;
				setSelectedAlert(null);
				setTradeCard(null);
			}),
		[manager],
	);
	const armAlert = (on: boolean) => {
		setAlertMode(on);
		if (!on) return;
		setSelectedAlert(null);
		setTradeCard(null);
		manager?.select([]);
	};

	// Indicators follow the candles and the store.
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart || !theme || data.status !== "ready") return;
		syncIndicators(chart, indicatorsRef.current, data.candles, drawnIndicators, hidden, config, saved, theme, window.matchMedia(PHONE).matches);
	}, [data.status, data.candles, drawnIndicators, hidden, config, saved, theme, manager]);

	// Alert lines: only an alert against a value has one, in its color (the accent when it has none), the selected
	// one thicker. The price's on the candles; an indicator's in that indicator's pane while it is on (S6). Removed on
	// cleanup, before the indicator effect rebuilds the series they sit on.
	const selectedId = selectedAlert?.id;
	useEffect(() => {
		const candles = seriesRef.current;
		if (!candles || !theme) return;
		const draggable = alertLinesRef.current;
		const made: [ISeriesApi<SeriesType>, IPriceLine][] = [];
		for (const a of shownAlerts) {
			if (a.target !== "value" || a.value === null) continue;
			const host: ISeriesApi<SeriesType> | undefined =
				a.source === "price" ? candles : indicatorsRef.current.list.find((i) => i.key === indicatorOf(a.source))?.series[0];
			if (!host) continue;
			const active = a.status === "active";
			const line = host.createPriceLine({
				price: a.value,
				color: active ? (a.color ?? theme.accent) : theme.ink3,
				lineStyle: active ? LineStyle.Solid : LineStyle.Dashed,
				lineWidth: a.id === selectedId ? 2 : 1,
				axisLabelVisible: true,
				title: ALERT_TITLES[a.status],
			});
			made.push([host, line]);
			if (host === candles) draggable.set(a.id, line);
		}
		return () => {
			draggable.clear();
			// After the chart is gone (unmount) there is nothing to remove them from.
			if (chartRef.current) made.forEach(([series, line]) => series.removePriceLine(line));
		};
	}, [shownAlerts, theme, manager, selectedId, enabled, config, data.status]);

	// Alert placement and dragging. Capture phase: an alert under the pointer
	// wins over the drawing layer and the chart's own panning.
	useEffect(() => {
		// One thing selected at a time: an alert takes the selection from the drawings.
		const select = (id: string, y: number) => {
			manager?.setTool(null);
			manager?.select([]);
			setTradeCard(null);
			setSelectedAlert({ id, y });
		};
		const box = boxRef.current;
		const chart = chartRef.current;
		const series = seriesRef.current;
		// A peso chart in dollars: its alerts, in pesos, cannot be placed or moved on it.
		if (!box || !chart || !series || usd) return;
		// Only the price against a value has a line on the price pane to grab.
		const lines = shownAlerts.filter((a): a is ChartAlert & { value: number } => isPriceValue(a) && a.value !== null);

		const onDown = (e: PointerEvent) => {
			const y = e.clientY - box.getBoundingClientRect().top;
			pressRef.current = { taken: true, touch: e.pointerType === "touch" };
			if (alertMode) {
				const price = series.coordinateToPrice(y);
				e.stopPropagation();
				setAlertMode(false);
				if (price !== null) create(roundPrice(price));
				return;
			}
			if (manager?.tool()) return;
			const touch = e.pointerType === "touch";
			const id = hitTestAlert(lines, y, (p) => series.priceToCoordinate(p), touch ? TOUCH_HIT_PX : undefined);
			pressRef.current.taken = !!id;
			// A finger only drags the selected alert (odd/tasks/chart-customization.md S1): across
			// any other line, or off them, it pans the chart, and a tap selects or deselects.
			if (touch && id !== selectedId) {
				if (id) e.stopPropagation(); // the alert, not a drawing under it, takes the tap
				onTap(e, TOUCH_DRAG_PX, () => (id ? select(id, y) : setSelectedAlert(null)));
				return;
			}
			if (!id) {
				setSelectedAlert(null);
				return;
			}
			e.stopPropagation();
			e.preventDefault();
			const line = alertLinesRef.current.get(id);
			const original = lines.find((a) => a.id === id)!.value;
			let price = original;
			let lastY = y;
			let dragged = false;
			chart.applyOptions({ handleScroll: false, handleScale: false });
			const onMovePtr = (ev: PointerEvent) => {
				const yy = ev.clientY - box.getBoundingClientRect().top;
				if (!dragged && Math.abs(yy - y) < (touch ? TOUCH_DRAG_PX : DRAG_THRESHOLD_PX)) return;
				dragged = true;
				lastY = yy;
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
					select(id, y);
					return;
				}
				const moved = await move(id, price);
				if (!moved) line?.applyOptions({ price: original });
				// The selected alert's bar goes with its line.
				setSelectedAlert((s) => (s?.id === id ? { id, y: moved ? lastY : y } : s));
			};
			window.addEventListener("pointermove", onMovePtr);
			window.addEventListener("pointerup", onUp);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setAlertMode(false);
				setSelectedAlert(null);
				setTradeCard(null);
			}
		};
		box.addEventListener("pointerdown", onDown, true);
		window.addEventListener("keydown", onKey);
		return () => {
			box.removeEventListener("pointerdown", onDown, true);
			window.removeEventListener("keydown", onKey);
		};
	}, [alertMode, shownAlerts, create, move, manager, selectedId, usd]);

	useEffect(() => {
		setSelectedAlert(null);
		setSheet(null);
	}, [symbol]);

	// A line's last value on the chart, for the sheet to start from: the price, or an indicator's.
	const lastValue = (line: string) => {
		if (line === "price") return last?.close ?? null;
		const found = INDICATOR_SPECS[indicatorOf(line)].lines(data.candles, config).find((l) => l.id === lineIdOf(line));
		return found?.data.at(-1)?.value ?? null;
	};
	const sheetAlert = sheet?.id ? alerts.find((a) => a.id === sheet.id) : undefined;

	const drawnLast = drawn.at(-1) ?? null;
	const shown = hover ?? drawnLast;
	const prevClose = drawn.at(-2)?.close;
	const change = shown && prevClose && shown === drawnLast ? (shown.close - prevClose) / prevClose : shown ? (shown.close - shown.open) / shown.open : null;
	const at = hover?.time ?? null;
	const comparingNow = comparing.length > 0;
	const from = base?.time ?? null;
	const compareRows = comparingNow
		? [
				{ symbol, color: line ? theme?.accent : theme?.ink, pct: base ? pctFrom(drawn.map((c) => ({ time: c.time, value: c.close })), from, at) : null, main: true, missing: false },
				...comparing.map((s, i) => {
					const points = aligned.get(s);
					return { symbol: s, color: COMPARE_COLORS[i % COMPARE_COLORS.length], pct: points && base ? pctFrom(points, from, at) : null, main: false, missing: compared.status === "ready" && !points };
				}),
			]
		: [];
	const selected: ChartAlert | undefined = selectedAlert ? alerts.find((a) => a.id === selectedAlert.id) : undefined;

	return (
		<div className="flex min-h-0 flex-1">
			<DrawingTools
				manager={usd ? null : manager}
				alertsOff={usd}
				alertMode={alertMode}
				onAlertMode={armAlert}
				phoneBar={phoneBar}
				chartArea={area}
				symbol={symbol}
				alerts={alerts}
				onNewAlert={() => setSheet({ id: null })}
				onOpenAlert={(id) => setSheet({ id })}
			/>
			<div ref={setArea} className="relative min-h-0 min-w-0 flex-1">
				{/* touch-none: the chart pans and zooms itself; left to the browser, a finger drag on a
				    drawing or an alert is taken over as a page scroll and cancelled halfway. isolate: the
				    library's pane separators sit at z-index 50, above the phone's app menu, unless kept in
				    here; only there, as a computer's text rendering changes with it. */}
				<div ref={boxRef} data-chart-box className={cn("absolute inset-0 touch-none max-[819px]:isolate", alertMode && "cursor-crosshair")} />

				<div data-chart-legend className="pointer-events-none absolute left-3 top-2 z-10 flex max-w-[calc(100%-5rem)] flex-col gap-1 text-[13px]">
					<div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 tabular-nums">
						{shown && line && <span className="text-ink-3">Valor <span className="text-ink">{priceText(shown.close)}</span></span>}
						{shown && !line && (
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
					{compareRows.map((r) => (
						<div key={r.symbol} className="pointer-events-auto flex w-fit items-center gap-1.5 rounded bg-canvas px-1 tabular-nums text-ink-2">
							<span aria-hidden className="h-0.5 w-3 rounded" style={{ background: r.color }} />
							<span className="text-ink">{seriesLabel(r.symbol)}</span>
							{r.missing ? (
								<span className="text-ink-3">Sin datos</span>
							) : (
								r.pct !== null && <span className={r.pct >= 0 ? "text-ok" : "text-danger"}>{formatNumber(r.pct, { sign: true })} %</span>
							)}
							{!r.main && (
								<button type="button" aria-label={`Quitar ${seriesLabel(r.symbol)} de la comparación`} title="Quitar" onClick={() => setCompareSymbols(compareSymbols.filter((s) => s !== r.symbol))} className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink max-[819px]:h-8 max-[819px]:w-8">
									<X className="h-3.5 w-3.5" aria-hidden />
								</button>
							)}
						</div>
					))}
					{comparingNow && (
						<div role="group" aria-label="Comparar desde" className="pointer-events-auto flex w-fit flex-wrap items-center gap-0.5 rounded bg-canvas p-0.5 text-[12px] tabular-nums">
							{COMPARE_RANGES.map((r) => (
								<button
									key={r}
									type="button"
									aria-pressed={r === compareRange}
									onClick={() => setCompareRange(r)}
									className={cn("rounded px-1.5 py-0.5 text-ink-3 hover:bg-hover hover:text-ink max-[819px]:min-h-8 max-[819px]:px-2", r === compareRange && "bg-accent-soft font-medium text-accent-ink")}
								>
									{r}
								</button>
							))}
							{base && <span className="px-1 text-ink-3">desde {dayText(base.time)}</span>}
						</div>
					)}
					{comparingNow && compared.status === "error" && <p className={legendNote}>No se pudieron cargar las comparaciones.</p>}
					{usd && <p className={legendNote}>Dibujos y alertas: en pausa al comparar en dólares</p>}
					{!daily && others.length > 0 && <p className={legendNote}>Las comparaciones se ven en diario, semanal o mensual</p>}
					{daily && others.length < MAX_COMPARE && (
						<button type="button" onClick={() => setCompareOpen(true)} className="pointer-events-auto inline-flex w-fit items-center rounded bg-canvas px-1 text-ink-2 hover:bg-hover hover:text-ink max-[819px]:min-h-8">
							+ Comparar
						</button>
					)}
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
						{selected.status !== "active" && (
							<button type="button" onClick={() => rearm(selected.id)} className="rounded px-2 py-1 text-accent-ink hover:bg-accent-soft max-[819px]:min-h-11 max-[819px]:px-3">
								Reactivar
							</button>
						)}
						<button
							type="button"
							aria-label="Configuración"
							title="Configuración"
							onClick={() => setSheet({ id: selected.id })}
							className="grid shrink-0 place-items-center rounded px-1.5 py-1 text-ink-2 hover:bg-hover hover:text-ink max-[819px]:min-h-11 max-[819px]:min-w-11"
						>
							<Settings2 className="h-4 w-4" aria-hidden />
						</button>
						<button
							type="button"
							onClick={() => {
								remove(selected.id);
								setSelectedAlert(null);
							}}
							className="rounded px-2 py-1 text-danger hover:bg-danger-soft max-[819px]:min-h-11 max-[819px]:px-3"
						>
							Borrar
						</button>
						<button type="button" onClick={() => setSelectedAlert(null)} className="shrink-0 rounded px-2 py-1 font-medium text-ink hover:bg-hover max-[819px]:min-h-11 max-[819px]:px-3">
							Listo
						</button>
					</div>
				)}

				{/* A card is for the bars it was opened on: another symbol or timeframe drops it. */}
				{tradeCard?.chart === `${symbol}:${timeframe}` && trades.get(tradeCard.time) && (
					tradeCard.phone ? (
						<TradeSheet trades={trades.get(tradeCard.time)!} onClose={() => setTradeCard(null)} />
					) : (
						<TradeCard trades={trades.get(tradeCard.time)!} x={tradeCard.x} y={tradeCard.y} above={tradeCard.above} onClose={() => setTradeCard(null)} />
					)
				)}

				<DrawingActions manager={manager} onEditText={(drawing) => setTextEdit({ drawing, x: 12, y: 56 })} />

				{sheet && (sheet.id === null || sheetAlert) && (
					<AlertSheet
						key={sheet.id ?? "new"}
						open
						onOpenChange={(open) => !open && setSheet(null)}
						ticker={symbol}
						alert={sheetAlert}
						timeframe={timeframe}
						config={config}
						lastValue={lastValue}
						onSave={async (draft) => {
							if (await save(sheet.id, draft)) setSheet(null);
						}}
						onDelete={() => {
							if (sheet.id) remove(sheet.id);
							setSheet(null);
							setSelectedAlert(null);
						}}
						onRearm={() => sheet.id && rearm(sheet.id)}
					/>
				)}

				{compareOpen && <CompareSheet open onOpenChange={setCompareOpen} main={symbol} />}

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
							<p role="status" className="text-ink-3">Cargando {seriesLabel(symbol)}…</p>
						) : (
							<div role="alert" className="flex flex-col items-center gap-3 text-center">
								<p className="text-ink">No se pudo cargar {seriesLabel(symbol)}</p>
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
