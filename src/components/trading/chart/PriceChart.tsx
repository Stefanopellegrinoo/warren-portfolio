"use client";

import { useEffect, useRef, useState } from "react";
import {
	createChart,
	CandlestickSeries,
	LineSeries,
	HistogramSeries,
	CrosshairMode,
	LineStyle,
	type IChartApi,
	type ISeriesApi,
	type IPriceLine,
	type UTCTimestamp,
} from "lightweight-charts";
import { fetchKlines } from "@/lib/binance/rest";
import { getBinanceWS } from "@/lib/binance/ws";
import { ema, rsi, macd, stochastic, adx } from "@/lib/indicators";
import { getProviderForSymbol } from "@/lib/market-data/resolver";
import type { Candle, Timeframe } from "@/lib/binance/types";
import {
	INDICATOR_COLORS,
	useChartStore,
	type IndicatorKey,
} from "@/lib/store/chart-store";
import { formatPrice, formatVolume } from "@/lib/format";
import { IndicatorPill } from "./IndicatorPill";
import { DrawingOverlay } from "./DrawingOverlay";
import { DrawingToolbar } from "./DrawingToolbar";
import { AlertCreationWidget } from "./AlertCreationWidget";
import { AlertEditWidget } from "./AlertEditWidget";
import { toast } from "sonner";
import type { DrawingPoint, DrawingType } from "@/lib/types/drawings";
import { DEFAULT_STYLE } from "@/lib/types/drawings";
import {
	distanceToSegment,
	distanceToRay,
	perpendicularOffset,
	distanceToRectPerimeter,
} from "@/lib/drawings/hit-test";
import { computeFibonacciLevels } from "@/lib/drawings/fibonacci";

// --- TYPES ---
interface PaneOffset {
	top: number;
	height: number;
}
interface LastValues {
	ema20?: number;
	ema50?: number;
	ema200?: number;
	rsi?: number;
	macd?: number;
	macdSignal?: number;
	volume?: number;
	stochK?: number;
	stochD?: number;
	adx?: number;
}
interface HoverInfo {
	o: number;
	h: number;
	l: number;
	c: number;
	v: number;
	time: number;
	pct: number;
}
interface PriceAlert {
	id: string;
	user_id: string;
	ticker: string;
	type: string;
	operator: string;
	value: number;
	name: string;
	channel: string;
	status: string;
	created_at: string;
	triggered_at: string | null;
}
interface GestureRef {
	mode: "idle" | "pressed" | "dragging";
	alertId: string | null;
	startY: number;
	originalPrice: number;
	currentPrice: number;
}

// --- CONSTANTS ---
const TV_COLORS = {
	bg: "#131722",
	panel: "#1e222d",
	border: "#2a2e39",
	text: "#d1d4dc",
	textMuted: "#787b86",
	green: "#26a69a",
	red: "#ef5350",
	blue: "#2196F3",
	orange: "#f59e0b",
	yellow: "#ffb74d",
	grid: "#1e222d",
};

// --- UTILS (OUTSIDE COMPONENT) ---
function extendToCanvas(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	width: number,
): [number, number, number, number] {
	if (width === 0 || Math.abs(bx - ax) < 0.001) return [ax, ay, bx, by];
	const slope = (by - ay) / (bx - ax);
	const b = ay - slope * ax;
	return [0, b, width, slope * width + b];
}

function findSnappedPoint(
	time: number,
	price: number,
	candles: Candle[],
): { time: number; price: number } {
	const candle = candles.find((c) => c.time === time);
	if (!candle) return { time, price };
	const options = [candle.open, candle.high, candle.low, candle.close];
	let bestPrice = options[0];
	let minDist = Math.abs(price - options[0]);
	for (let i = 1; i < options.length; i++) {
		const dist = Math.abs(price - options[i]);
		if (dist < minDist) {
			minDist = dist;
			bestPrice = options[i];
		}
	}
	return { time, price: bestPrice };
}

// Price alert hit-test: returns alert ID if within 8px of alert line, else null
export function hitTestAlertLine(
	alertDataRef: React.MutableRefObject<Map<string, PriceAlert>>,
	mouseY: number,
	priceToCoordinate: (price: number) => number | null,
	tolerance = 8,
): string | null {
	let bestId: string | null = null;
	let bestDist = tolerance + 1;
	for (const [id, alert] of alertDataRef.current.entries()) {
		const coord = priceToCoordinate(alert.value);
		if (coord === null) continue;
		const dist = Math.abs(coord - mouseY);
		if (dist <= tolerance && dist < bestDist) {
			bestDist = dist;
			bestId = id;
		}
	}
	return bestId;
}

// Tap detection: < 5px movement counts as a tap
export function isTap(downY: number, upY: number): boolean {
	return Math.abs(upY - downY) < 5;
}

// --- MAIN COMPONENT ---
export function PriceChart({
	symbol,
	timeframe,
}: {
	symbol: string;
	timeframe: Timeframe;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
	const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

	// Indicator Refs
	const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
	const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
	const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
	const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
	const rsi30Ref = useRef<ISeriesApi<"Line"> | null>(null);
	const rsi70Ref = useRef<ISeriesApi<"Line"> | null>(null);
	const macdRef = useRef<ISeriesApi<"Line"> | null>(null);
	const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
	const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
	const stochKRef = useRef<ISeriesApi<"Line"> | null>(null);
	const stochDRef = useRef<ISeriesApi<"Line"> | null>(null);
	const stoch20Ref = useRef<ISeriesApi<"Line"> | null>(null);
	const stoch80Ref = useRef<ISeriesApi<"Line"> | null>(null);
	const adxRef = useRef<ISeriesApi<"Line"> | null>(null);
	const adxPlusDIRef = useRef<ISeriesApi<"Line"> | null>(null);
	const adxMinusDIRef = useRef<ISeriesApi<"Line"> | null>(null);
	const adx25Ref = useRef<ISeriesApi<"Line"> | null>(null);

	const candlesRef = useRef<Candle[]>([]);

	// Store
	const indicators = useChartStore((s) => s.indicators);
	const hidden = useChartStore((s) => s.hidden);
	const config = useChartStore((s) => s.config);
	const tool = useChartStore((s) => s.tool);
	const drawings = useChartStore((s) => s.drawings);
	const inProgressDrawing = useChartStore((s) => s.inProgressDrawing);
	const magnetMode = useChartStore((s) => s.magnetMode);

	const actions = {
		add: useChartStore((s) => s.addDrawing),
		update: useChartStore((s) => s.updateDrawing),
		remove: useChartStore((s) => s.removeDrawing),
		replace: useChartStore((s) => s.replaceDrawings),
		setToolStyle: useChartStore((s) => s.updateToolStyle),
		toggleHidden: useChartStore((s) => s.toggleHidden),
		setSettings: useChartStore((s) => s.setSettingsTarget),
		removeIndicator: useChartStore((s) => s.removeIndicator),
	};

	// Local State
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(
		null,
	);
	const [hover, setHover] = useState<HoverInfo | null>(null);
	// Alert state (restored from 4b85394)
	const [hoverY, setHoverY] = useState<number | null>(null);
	const [alertWidget, setAlertWidget] = useState<{ price: number } | null>(
		null,
	);
	const [editingAlert, setEditingAlert] = useState<PriceAlert | null>(null);
	const [lastPrice, setLastPrice] = useState<{
		value: number;
		pct: number;
	} | null>(null);
	const [lastValues, setLastValues] = useState<LastValues>({});
	const [paneOffsets, setPaneOffsets] = useState<PaneOffset[]>([]);
	const [previewPt, setPreviewPt] = useState<DrawingPoint | null>(null);
	const [renderTick, setRenderTick] = useState(0);

	const refs = {
		tool: useRef(tool),
		symbol: useRef(symbol),
		drawings: useRef(drawings),
		inProg: useRef(inProgressDrawing),
		move: useRef<{
			id: string;
			orig: DrawingPoint[];
			sP: number;
			sT: number;
		} | null>(null),
	};
	refs.tool.current = tool;
	refs.symbol.current = symbol;
	refs.drawings.current = drawings;
	refs.inProg.current = inProgressDrawing;

	// Alert refs (restored from 4b85394)
	const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const alertPriceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
	const alertDataRef = useRef<Map<string, PriceAlert>>(new Map());
	const gestureRef = useRef<GestureRef>({
		mode: "idle",
		alertId: null,
		startY: 0,
		originalPrice: 0,
		currentPrice: 0,
	});

	const provider = getProviderForSymbol(symbol);

	// --- LOGIC ---
	function recomputePaneOffsets() {
		if (!chartRef.current) return;
		try {
			const panes = chartRef.current.panes();
			const newOffsets: PaneOffset[] = [];
			let top = 0;
			for (const p of panes) {
				const h = p.getHeight();
				newOffsets.push({ top, height: h });
				top += h;
			}
			setPaneOffsets(newOffsets);
		} catch {
			// Silently ignore errors from chart library pane operations
		}
	}

	function updateEMAs() {
		const c = candlesRef.current;
		if (c.length === 0) return;
		const cfg = config;
		let v20: number | undefined,
			v50: number | undefined,
			v200: number | undefined;
		if (ema20Ref.current) {
			const d = ema(c, cfg.ema20);
			ema20Ref.current.setData(
				d.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
			);
			v20 = d.at(-1)?.value;
		}
		if (ema50Ref.current) {
			const d = ema(c, cfg.ema50);
			ema50Ref.current.setData(
				d.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
			);
			v50 = d.at(-1)?.value;
		}
		if (ema200Ref.current) {
			const d = ema(c, cfg.ema200);
			ema200Ref.current.setData(
				d.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
			);
			v200 = d.at(-1)?.value;
		}
		setLastValues((prev) => ({
			...prev,
			ema20: v20,
			ema50: v50,
			ema200: v200,
			volume: c.at(-1)?.volume,
		}));
	}

	function updateRSI() {
		const c = candlesRef.current;
		if (c.length === 0 || !rsiRef.current) return;
		const rData = rsi(c, config.rsi).map((p) => ({
			time: p.time as UTCTimestamp,
			value: p.value,
		}));
		rsiRef.current.setData(rData);
		if (rData.length > 0) {
			const tStart = rData[0].time;
			const tEnd = rData[rData.length - 1].time;
			rsi30Ref.current?.setData([
				{ time: tStart, value: 30 },
				{ time: tEnd, value: 30 },
			]);
			rsi70Ref.current?.setData([
				{ time: tStart, value: 70 },
				{ time: tEnd, value: 70 },
			]);
		}
		setLastValues((prev) => ({ ...prev, rsi: rData.at(-1)?.value }));
	}

	function updateMACD() {
		const c = candlesRef.current;
		if (c.length === 0 || !macdRef.current) return;
		const m = macd(c, config.macdFast, config.macdSlow, config.macdSignal);
		macdRef.current.setData(
			m.map((p) => ({ time: p.time as UTCTimestamp, value: p.macd })),
		);
		macdSignalRef.current?.setData(
			m.map((p) => ({ time: p.time as UTCTimestamp, value: p.signal })),
		);
		macdHistRef.current?.setData(
			m.map((p) => ({
				time: p.time as UTCTimestamp,
				value: p.histogram,
				color: p.histogram >= 0 ? `${TV_COLORS.green}80` : `${TV_COLORS.red}80`,
			})),
		);
		setLastValues((prev) => ({
			...prev,
			macd: m.at(-1)?.macd,
			macdSignal: m.at(-1)?.signal,
		}));
	}

	function updateStochastic() {
		const c = candlesRef.current;
		if (c.length === 0 || !stochKRef.current) return;
		const s = stochastic(c, config.stochK, config.stochSmooth, config.stochD);
		stochKRef.current.setData(
			s.map((p) => ({ time: p.time as UTCTimestamp, value: p.k })),
		);
		stochDRef.current?.setData(
			s.map((p) => ({ time: p.time as UTCTimestamp, value: p.d })),
		);
		if (s.length > 0) {
			const tStart = s[0].time as UTCTimestamp;
			const tEnd = s[s.length - 1].time as UTCTimestamp;
			stoch20Ref.current?.setData([
				{ time: tStart, value: 20 },
				{ time: tEnd, value: 20 },
			]);
			stoch80Ref.current?.setData([
				{ time: tStart, value: 80 },
				{ time: tEnd, value: 80 },
			]);
		}
		setLastValues((prev) => ({
			...prev,
			stochK: s.at(-1)?.k,
			stochD: s.at(-1)?.d,
		}));
	}

	function updateADX() {
		const c = candlesRef.current;
		if (c.length === 0 || !adxRef.current) return;
		const a = adx(c, config.adxPeriod);
		adxRef.current.setData(
			a.map((p) => ({ time: p.time as UTCTimestamp, value: p.adx })),
		);
		adxPlusDIRef.current?.setData(
			a.map((p) => ({ time: p.time as UTCTimestamp, value: p.plusDI })),
		);
		adxMinusDIRef.current?.setData(
			a.map((p) => ({ time: p.time as UTCTimestamp, value: p.minusDI })),
		);
		if (a.length > 0) {
			const tStart = a[0].time as UTCTimestamp;
			const tEnd = a[a.length - 1].time as UTCTimestamp;
			adx25Ref.current?.setData([
				{ time: tStart, value: 25 },
				{ time: tEnd, value: 25 },
			]);
		}
		setLastValues((prev) => ({ ...prev, adx: a.at(-1)?.adx }));
	}

	function updateAllIndicators() {
		updateEMAs();
		updateRSI();
		updateMACD();
		updateStochastic();
		updateADX();
	}

	function applyCandles(klines: Candle[]) {
		candlesRef.current = klines;
		if (candleSeriesRef.current)
			candleSeriesRef.current.setData(
				klines.map((k) => ({
					time: k.time as UTCTimestamp,
					open: k.open,
					high: k.high,
					low: k.low,
					close: k.close,
				})),
			);
		if (volumeSeriesRef.current)
			volumeSeriesRef.current.setData(
				klines.map((k) => ({
					time: k.time as UTCTimestamp,
					value: k.volume,
					color:
						k.close >= k.open ? `${TV_COLORS.green}66` : `${TV_COLORS.red}66`,
				})),
			);
		updateAllIndicators();
		chartRef.current?.timeScale().fitContent();
		if (klines.length > 0) {
			const last = klines.at(-1)!;
			const prev = klines.at(-2) ?? last;
			setLastPrice({
				value: last.close,
				pct:
					prev.close === 0 ? 0 : ((last.close - prev.close) / prev.close) * 100,
			});
		}
	}

	// Alert helper functions (restored from 4b85394)
	function addAlertPriceLine(alert: PriceAlert) {
		const series = candleSeriesRef.current;
		if (!series) return;
		if (alertPriceLinesRef.current.has(alert.id)) return;
		const line = series.createPriceLine({
			price: alert.value,
			color: "#f59e0b",
			lineWidth: 1,
			lineStyle: LineStyle.Dashed,
			axisLabelVisible: true,
			title: alert.name,
		});
		alertPriceLinesRef.current.set(alert.id, line);
		alertDataRef.current.set(alert.id, alert);
	}

	function updateAlertLine(alert: PriceAlert) {
		const line = alertPriceLinesRef.current.get(alert.id);
		if (line) {
			line.applyOptions({ price: alert.value, title: alert.name });
		}
		alertDataRef.current.set(alert.id, alert);
	}

	function removeAlertLine(id: string) {
		const series = candleSeriesRef.current;
		const line = alertPriceLinesRef.current.get(id);
		if (line && series) {
			try {
				series.removePriceLine(line);
			} catch {}
		}
		alertPriceLinesRef.current.delete(id);
		alertDataRef.current.delete(id);
	}

	// --- INITIALIZATION EFFECT ---
	useEffect(() => {
		if (!containerRef.current) return;
		const chart = createChart(containerRef.current, {
			layout: {
				background: { color: TV_COLORS.bg },
				textColor: TV_COLORS.text,
				fontFamily: "Inter, sans-serif",
				fontSize: 11,
			},
			grid: {
				vertLines: { color: TV_COLORS.grid },
				horzLines: { color: TV_COLORS.grid },
			},
			crosshair: { mode: CrosshairMode.Normal },
			rightPriceScale: {
				borderColor: TV_COLORS.border,
				textColor: TV_COLORS.textMuted,
				minimumWidth: 70,
			},
			timeScale: {
				borderColor: TV_COLORS.border,
				timeVisible: true,
				rightOffset: 12,
				barSpacing: 8,
			},
			autoSize: true,
		});
		chartRef.current = chart;
		chart
			.timeScale()
			.subscribeVisibleLogicalRangeChange(() => setRenderTick((v) => v + 1));

		chart.subscribeCrosshairMove((param) => {
			if (!param.point || !candleSeriesRef.current) {
				setHover(null);
				setPreviewPt(null);
				return;
			}
			let p = candleSeriesRef.current.coordinateToPrice(param.point.y) as
				| number
				| null;
			const t = param.time as number;
			if (p !== null && t) {
				if (useChartStore.getState().magnetMode) {
					const s = findSnappedPoint(t, p, candlesRef.current);
					p = s.price;
				}
				setPreviewPt({ time: t as UTCTimestamp, price: p });
			}
			const data = param.seriesData.get(candleSeriesRef.current) as any;
			if (data) {
				setHover({
					o: data.open,
					h: data.high,
					l: data.low,
					c: data.close,
					v:
						(param.seriesData.get(volumeSeriesRef.current!) as any)?.value || 0,
					time: t,
					pct:
						data.open === 0 ? 0 : ((data.close - data.open) / data.open) * 100,
				});
			}
		});

		candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
			upColor: TV_COLORS.green,
			downColor: TV_COLORS.red,
			borderUpColor: TV_COLORS.green,
			borderDownColor: TV_COLORS.red,
			wickUpColor: TV_COLORS.green,
			wickDownColor: TV_COLORS.red,
			priceLineColor: TV_COLORS.textMuted,
			priceLineStyle: 2,
		});
		volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
			priceFormat: { type: "volume" },
			priceScaleId: "",
			lastValueVisible: false,
			priceLineVisible: false,
		});
		volumeSeriesRef.current
			.priceScale()
			.applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

		ema20Ref.current = chart.addSeries(LineSeries, {
			color: INDICATOR_COLORS.ema20,
			lineWidth: 2,
			priceLineVisible: false,
			lastValueVisible: false,
		});
		ema50Ref.current = chart.addSeries(LineSeries, {
			color: INDICATOR_COLORS.ema50,
			lineWidth: 2,
			priceLineVisible: false,
			lastValueVisible: false,
		});
		ema200Ref.current = chart.addSeries(LineSeries, {
			color: INDICATOR_COLORS.ema200,
			lineWidth: 2,
			priceLineVisible: false,
			lastValueVisible: false,
		});

		chart.subscribeClick((param) => {
			if (!param.point || !candleSeriesRef.current) {
				setSelectedId(null);
				setToolbarPos(null);
				return;
			}
			if (refs.tool.current === "cursor" || refs.tool.current === "eraser")
				return;
			let p = candleSeriesRef.current.coordinateToPrice(param.point.y) as
				| number
				| null;
			const t = param.time as number;
			if (p === null || !t) return;
			if (useChartStore.getState().magnetMode) {
				const s = findSnappedPoint(t, p, candlesRef.current);
				p = s.price;
			}
			if (
				refs.tool.current === "hline" ||
				refs.tool.current === "horizontal_ray"
			) {
				const type = refs.tool.current as DrawingType;
				const id = crypto.randomUUID();
				const style =
					useChartStore.getState().toolStyles[type] ||
					DEFAULT_STYLE[type] ||
					DEFAULT_STYLE.trendline;
				actions.add({
					id,
					userId: "",
					ticker: refs.symbol.current,
					type,
					points: [{ time: t as UTCTimestamp, price: p }],
					style,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				});
				fetch("/api/drawings", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						ticker: refs.symbol.current,
						type,
						points: [{ time: t, price: p }],
						style,
					}),
				})
					.then((r) => r.json())
					.then((c) =>
						actions.replace(
							refs.drawings.current.map((d) => (d.id === id ? c : d)),
						),
					);
			}
		});

		return () => {
			chart.remove();
			chartRef.current = null;
		};
	}, []);

	// --- DATA SYNC EFFECT ---
	useEffect(() => {
		let cancelled = false;
		let unsub: (() => void) | null = null;
		setSelectedId(null);
		setToolbarPos(null);
		async function load() {
			try {
				if (provider === "binance") {
					const k = await fetchKlines(symbol, timeframe, 1000);
					if (!cancelled) applyCandles(k);
					unsub = getBinanceWS().subscribeKline({
						symbol,
						interval: timeframe,
						onCandle: (k) => {
							if (!candleSeriesRef.current) return;
							const arr = candlesRef.current;
							if (arr.at(-1)?.time === k.time) arr[arr.length - 1] = k;
							else if (!arr.at(-1) || k.time > arr.at(-1)!.time) {
								arr.push(k);
								if (arr.length > 2000) arr.shift();
							} else return;
							candleSeriesRef.current.update({
								time: k.time as UTCTimestamp,
								open: k.open,
								high: k.high,
								low: k.low,
								close: k.close,
							});
							if (volumeSeriesRef.current)
								volumeSeriesRef.current.update({
									time: k.time as UTCTimestamp,
									value: k.volume,
									color:
										k.close >= k.open
											? `${TV_COLORS.green}66`
											: `${TV_COLORS.red}66`,
								});
							updateAllIndicators();
							const prev = arr.at(-2) ?? k;
							setLastPrice({
								value: k.close,
								pct:
									prev.close === 0
										? 0
										: ((k.close - prev.close) / prev.close) * 100,
							});
						},
					});
				} else {
					const res = await fetch(
						`/api/klines?ticker=${encodeURIComponent(symbol)}&interval=${timeframe === "1w" ? "1w" : "1d"}`,
					);
					const raw = await res.json();
					if (cancelled) return;
					applyCandles(
						raw.map((k: any) => ({
							time: Math.floor(
								new Date(k.time + "T00:00:00Z").getTime() / 1000,
							),
							open: k.open,
							high: k.high,
							low: k.low,
							close: k.close,
							volume: k.volume,
						})),
					);
					const id = setInterval(async () => {
						const q = await (
							await fetch(`/api/quote?ticker=${encodeURIComponent(symbol)}`)
						).json();
						if (q[0]?.price && candleSeriesRef.current) {
							const last = candlesRef.current.at(-1);
							if (!last) return;
							last.close = q[0].price;
							last.high = Math.max(last.high, q[0].price);
							last.low = Math.min(last.low, q[0].price);
							candleSeriesRef.current.update({
								time: last.time as UTCTimestamp,
								open: last.open,
								high: last.high,
								low: last.low,
								close: last.close,
							});
							updateAllIndicators();
							const prev = candlesRef.current.at(-2) ?? last;
							setLastPrice({
								value: q[0].price,
								pct:
									prev.close === 0
										? 0
										: ((q[0].price - prev.close) / prev.close) * 100,
							});
						}
					}, 60000);
					unsub = () => clearInterval(id);
				}
			} catch {
				// Silently ignore network errors during data load
			}
		}
		load();
		return () => {
			cancelled = true;
			if (unsub) unsub();
		};
	}, [symbol, timeframe, provider]);

	// --- LOAD SAVED DRAWINGS EFFECT ---
	useEffect(() => {
		let cancelled = false;
		// Clear drawings synchronously to prevent old ticker's drawings from showing
		actions.replace([]);
		async function loadDrawings() {
			try {
				const res = await fetch(
					`/api/drawings?ticker=${encodeURIComponent(symbol)}`,
				);
				if (!res.ok) return;
				const data = await res.json();
				if (!cancelled && Array.isArray(data)) {
					actions.replace(data);
				}
			} catch {
				// Silently ignore network or parse errors; preserve existing drawings
			}
		}
		loadDrawings();
		return () => {
			cancelled = true;
		};
	}, [symbol]);

	// Load alert price lines when symbol changes (restored from 4b85394)
	useEffect(() => {
		const series = candleSeriesRef.current;
		if (!series) return;

		// Clear previous alert lines synchronously
		for (const line of Array.from(alertPriceLinesRef.current.values())) {
			try {
				series.removePriceLine(line);
			} catch {}
		}
		alertPriceLinesRef.current.clear();
		alertDataRef.current.clear();

		let cancelled = false;

		async function loadAlertLines() {
			try {
				const res = await fetch(
					`/api/price-alerts?ticker=${encodeURIComponent(symbol)}`,
				);
				if (!res.ok || cancelled) return;
				const body = await res.json();
				const alerts: PriceAlert[] = body.alerts ?? [];
				if (cancelled || !candleSeriesRef.current) return;
				for (const alert of alerts) {
					if (alert.status !== "active") continue;
					const line = candleSeriesRef.current.createPriceLine({
						price: alert.value,
						color: "#f59e0b",
						lineWidth: 1,
						lineStyle: LineStyle.Dashed,
						axisLabelVisible: true,
						title: alert.name,
					});
					alertPriceLinesRef.current.set(alert.id, line);
					alertDataRef.current.set(alert.id, alert);
				}
			} catch {
				// Non-critical — skip silently
			}
		}

		loadAlertLines();

		return () => {
			cancelled = true;
		};
	}, [symbol]);

	// --- INDICATOR PANE SYNC ---
	const macdPaneIdx = indicators.rsi ? 2 : 1;
	const stochPaneIdx = (indicators.rsi ? 1 : 0) + (indicators.macd ? 1 : 0) + 1;
	const adxPaneIdx =
		(indicators.rsi ? 1 : 0) +
		(indicators.macd ? 1 : 0) +
		(indicators.stochastic ? 1 : 0) +
		1;

	useEffect(() => {
		if (!chartRef.current) return;
		const panes = chartRef.current.panes();
		if (panes.length > 0) {
			panes[0].setStretchFactor(6);
			for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);
		}
		recomputePaneOffsets();
	}, [indicators]);

	const useInd = (
		key: IndicatorKey,
		ref: any,
		addFn: () => void,
		cleanup: () => void,
	) => {
		useEffect(() => {
			if (!chartRef.current) return;
			if (indicators[key] && !ref.current) addFn();
			else if (!indicators[key] && ref.current) {
				chartRef.current.removeSeries(ref.current);
				cleanup();
			}
		}, [
			indicators[key],
			indicators.rsi,
			indicators.macd,
			indicators.stochastic,
		]);
	};

	useInd(
		"rsi",
		rsiRef,
		() => {
			rsiRef.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: INDICATOR_COLORS.rsi,
					lineWidth: 1,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				1,
			);
			rsi30Ref.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: TV_COLORS.textMuted,
					lineWidth: 1,
					lineStyle: 2,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				1,
			);
			rsi70Ref.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: TV_COLORS.textMuted,
					lineWidth: 1,
					lineStyle: 2,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				1,
			);
			updateRSI();
		},
		() => {
			rsiRef.current = rsi30Ref.current = rsi70Ref.current = null;
		},
	);

	useInd(
		"macd",
		macdRef,
		() => {
			macdRef.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: INDICATOR_COLORS.macd,
					lineWidth: 1,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				macdPaneIdx,
			);
			macdSignalRef.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: TV_COLORS.yellow,
					lineWidth: 1,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				macdPaneIdx,
			);
			macdHistRef.current = chartRef.current!.addSeries(
				HistogramSeries,
				{ priceLineVisible: false, lastValueVisible: false },
				macdPaneIdx,
			);
			updateMACD();
		},
		() => {
			macdRef.current = macdSignalRef.current = macdHistRef.current = null;
		},
	);

	useInd(
		"stochastic",
		stochKRef,
		() => {
			stochKRef.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: INDICATOR_COLORS.stochastic,
					lineWidth: 1,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				stochPaneIdx,
			);
			stochDRef.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: TV_COLORS.yellow,
					lineWidth: 1,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				stochPaneIdx,
			);
			stoch20Ref.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: TV_COLORS.textMuted,
					lineWidth: 1,
					lineStyle: 2,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				stochPaneIdx,
			);
			stoch80Ref.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: TV_COLORS.textMuted,
					lineWidth: 1,
					lineStyle: 2,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				stochPaneIdx,
			);
			updateStochastic();
		},
		() => {
			stochKRef.current =
				stochDRef.current =
				stoch20Ref.current =
				stoch80Ref.current =
					null;
		},
	);

	useInd(
		"adx",
		adxRef,
		() => {
			adxRef.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: INDICATOR_COLORS.adx,
					lineWidth: 2,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				adxPaneIdx,
			);
			adxPlusDIRef.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: TV_COLORS.green,
					lineWidth: 1,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				adxPaneIdx,
			);
			adxMinusDIRef.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: TV_COLORS.red,
					lineWidth: 1,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				adxPaneIdx,
			);
			adx25Ref.current = chartRef.current!.addSeries(
				LineSeries,
				{
					color: TV_COLORS.textMuted,
					lineWidth: 1,
					lineStyle: 2,
					priceLineVisible: false,
					lastValueVisible: false,
				},
				adxPaneIdx,
			);
			updateADX();
		},
		() => {
			adxRef.current =
				adxPlusDIRef.current =
				adxMinusDIRef.current =
				adx25Ref.current =
					null;
		},
	);

	useEffect(() => {
		updateAllIndicators();
	}, [config]);

	// --- INTERACTION EFFECT ---
	useEffect(() => {
		const c = containerRef.current;
		if (!c) return;
		function handleMouseDown(e: MouseEvent) {
			if (refs.tool.current !== "cursor") return;
			const rect = c?.getBoundingClientRect();
			if (!rect) return;
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			const ts = chartRef.current!.timeScale();
			const s = candleSeriesRef.current!;
			for (const d of refs.drawings.current) {
				let hit = false;
				const p1 = d.points[0];
				const p2 = d.points[1];
				const p3 = d.points[2];
				if (!p1) continue;
				const x1 = ts.timeToCoordinate(p1.time as UTCTimestamp);
				const y1 = s.priceToCoordinate(p1.price);
				if (y1 === null) continue;
				if (d.type === "hline" || d.type === "horizontal_ray")
					hit = Math.abs(y - y1) < 12;
				else if (p1 && p2) {
					const x2 = ts.timeToCoordinate(p2.time as UTCTimestamp);
					const y2 = s.priceToCoordinate(p2.price);
					if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
						if (d.type === "trendline") {
							const [ex1, ey1, ex2, ey2] = extendToCanvas(
								x1,
								y1,
								x2,
								y2,
								rect.width,
							);
							hit = distanceToSegment(x, y, ex1, ey1, ex2, ey2) < 12;
						} else if (d.type === "channel" && p3) {
							const offset = perpendicularOffset(
								x1,
								y1,
								x2,
								y2,
								ts.timeToCoordinate(p3.time as UTCTimestamp)!,
								s.priceToCoordinate(p3.price)!,
							);
							hit = [0, 0.5, 1, -1].some((m) => {
								const [lx1, ly1, lx2, ly2] = extendToCanvas(
									x1 + offset.dx * m,
									y1 + offset.dy * m,
									x2 + offset.dx * m,
									y2 + offset.dy * m,
									rect.width,
								);
								return distanceToSegment(x, y, lx1, ly1, lx2, ly2) < 12;
							});
						} else if (d.type === "fibonacci")
							hit = computeFibonacciLevels(p1, p2).some((l) => {
								const ly = s.priceToCoordinate(l.price);
								return ly !== null && Math.abs(y - ly) < 12;
							});
						else if (d.type === "ray")
							hit = distanceToRay(x, y, x1, y1, x2, y2) < 12;
						else if (d.type === "price_range")
							hit = distanceToRectPerimeter(x, y, x1, y1, x2, y2) < 12;
						else hit = distanceToSegment(x, y, x1, y1, x2, y2) < 12;
					}
				}
				if (hit) {
					e.preventDefault();
					e.stopPropagation();
					setSelectedId(d.id);
					setToolbarPos({ x, y });
					refs.move.current = {
						id: d.id,
						orig: d.points.map((p) => ({ ...p })),
						sP: s.coordinateToPrice(y) as number,
						sT: ts.coordinateToTime(x) as number,
					};
					const onMove = (me: MouseEvent) => {
						const m = refs.move.current;
						if (!m) return;
						const curP = s.coordinateToPrice(me.clientY - rect.top) as number;
						const curT = ts.coordinateToTime(me.clientX - rect.left) as number;
						if (curP === null || curT === null) return;
						const pD = curP - m.sP;
						const tD = (curT as number) - m.sT;
						let next = m.orig.map((p) => ({
							time: ((p.time as number) + tD) as UTCTimestamp,
							price: p.price + pD,
						}));
						if (useChartStore.getState().magnetMode)
							next = next.map(
								(p) =>
									findSnappedPoint(
										p.time as number,
										p.price,
										candlesRef.current,
									) as DrawingPoint,
							);
						actions.update(m.id, { points: next });
					};
					const onUp = () => {
						document.removeEventListener("mousemove", onMove);
						document.removeEventListener("mouseup", onUp);
						const df = refs.drawings.current.find((dr) => dr.id === d.id);
						if (df)
							fetch(`/api/drawings/${d.id}`, {
								method: "PATCH",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ points: df.points }),
							});
					};
					document.addEventListener("mousemove", onMove);
					document.addEventListener("mouseup", onUp);
					return;
				}
			}
			setSelectedId(null);
			setToolbarPos(null);
		}
		c.addEventListener("mousedown", handleMouseDown, { capture: true });
		return () =>
			c.removeEventListener("mousedown", handleMouseDown, { capture: true });
	}, []);

	const cW = containerRef.current?.clientWidth ?? 0;
	const cH = containerRef.current?.clientHeight ?? 0;

	return (
		<div className="relative h-full w-full">
			<div ref={containerRef} className="h-full w-full" />
			{cW > 0 && (
				<DrawingOverlay
					drawings={drawings}
					inProgressDrawing={inProgressDrawing}
					previewPoint2={previewPt}
					tool={tool}
					renderTick={renderTick}
					timeToX={(t) =>
						chartRef.current?.timeScale().timeToCoordinate(t) ?? null
					}
					priceToY={(p) =>
						candleSeriesRef.current?.priceToCoordinate(p) ?? null
					}
					containerWidth={cW}
					containerHeight={cH}
					xToTime={(x) =>
						(chartRef.current
							?.timeScale()
							.coordinateToTime(x) as UTCTimestamp) ?? null
					}
					yToPrice={(y) =>
						candleSeriesRef.current?.coordinateToPrice(y) ?? null
					}
					selectedId={selectedId}
					onDrag={(id, idx, pt) => {
						const d = refs.drawings.current.find((x) => x.id === id);
						if (!d) return;
						let fp = pt;
						if (magnetMode)
							fp = findSnappedPoint(
								pt.time as number,
								pt.price,
								candlesRef.current,
							) as DrawingPoint;
						const n = [...d.points];
						n[idx] = fp;
						actions.update(id, { points: n });
						fetch(`/api/drawings/${id}`, {
							method: "PATCH",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ points: n }),
						});
					}}
					onErase={(id) => {
						actions.remove(id);
						fetch(`/api/drawings/${id}`, { method: "DELETE" });
					}}
				/>
			)}
			{selectedId && toolbarPos && (
				<DrawingToolbar
					x={toolbarPos.x}
					y={toolbarPos.y}
					style={
						(drawings.find((d) => d.id === selectedId)?.style as any) || {
							color: "#2196F3",
							lineWidth: 2,
						}
					}
					onStyleChange={(s) => {
						const d = drawings.find((x) => x.id === selectedId);
						if (d) {
							actions.update(d.id, { style: s });
							actions.setToolStyle(d.type, s);
							fetch(`/api/drawings/${d.id}`, {
								method: "PATCH",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ style: s }),
							});
						}
					}}
					onDelete={() => {
						actions.remove(selectedId);
						fetch(`/api/drawings/${selectedId}`, { method: "DELETE" });
						setSelectedId(null);
					}}
					onClose={() => setSelectedId(null)}
				/>
			)}

			<div
				style={{ top: 12, left: 12 }}
				className="pointer-events-none absolute z-10 flex flex-col gap-1 text-xs tabular-nums text-tv-text"
			>
				<div className="flex h-5 flex-nowrap items-center gap-x-3 overflow-hidden whitespace-nowrap">
					<div className="flex shrink-0 items-center gap-2 text-[13px] font-semibold">
						{symbol} · {timeframe} ·{" "}
						{provider === "yahoo" ? "Yahoo" : "Binance"}
					</div>
					{hover && (
						<div className="flex items-center gap-x-3 text-[11px]">
							<span className="text-tv-text-muted">
								O{" "}
								<span
									className={
										hover.c >= hover.o ? "text-tv-green" : "text-tv-red"
									}
								>
									{formatPrice(hover.o)}
								</span>
							</span>
							<span className="text-tv-text-muted">
								H{" "}
								<span
									className={
										hover.c >= hover.o ? "text-tv-green" : "text-tv-red"
									}
								>
									{formatPrice(hover.h)}
								</span>
							</span>
							<span className="text-tv-text-muted">
								L{" "}
								<span
									className={
										hover.c >= hover.o ? "text-tv-green" : "text-tv-red"
									}
								>
									{formatPrice(hover.l)}
								</span>
							</span>
							<span className="text-tv-text-muted">
								C{" "}
								<span
									className={
										hover.c >= hover.o ? "text-tv-green" : "text-tv-red"
									}
								>
									{formatPrice(hover.c)}
								</span>
							</span>
							<span
								className={hover.pct >= 0 ? "text-tv-green" : "text-tv-red"}
							>
								{hover.pct >= 0 ? "+" : ""}
								{hover.pct.toFixed(2)}%
							</span>
							<span className="text-tv-text-muted">
								Vol{" "}
								<span className="text-tv-text">{formatVolume(hover.v)}</span>
							</span>
						</div>
					)}
				</div>
				<div className="flex h-7 items-center gap-2">
					{lastPrice ? (
						<>
							<span
								className={`text-lg font-semibold ${lastPrice.pct >= 0 ? "text-tv-green" : "text-tv-red"}`}
							>
								{formatPrice(lastPrice.value)}
							</span>
							<span
								className={lastPrice.pct >= 0 ? "text-tv-green" : "text-tv-red"}
							>
								{lastPrice.pct >= 0 ? "+" : ""}
								{lastPrice.pct.toFixed(2)}%
							</span>
						</>
					) : (
						<span className="text-tv-text-muted text-[11px]">Cargando...</span>
					)}
				</div>
				<div className="mt-1 flex flex-col items-start gap-1">
					{indicators.ema20 && (
						<IndicatorPill
							name={`EMA ${config.ema20}`}
							value={
								lastValues.ema20 ? formatPrice(lastValues.ema20) : undefined
							}
							color={INDICATOR_COLORS.ema20}
							hidden={hidden.ema20}
							onToggleHide={() => actions.toggleHidden("ema20")}
							onSettings={() => actions.setSettings("ema20")}
							onRemove={() => actions.removeIndicator("ema20")}
						/>
					)}
					{indicators.ema50 && (
						<IndicatorPill
							name={`EMA ${config.ema50}`}
							value={
								lastValues.ema50 ? formatPrice(lastValues.ema50) : undefined
							}
							color={INDICATOR_COLORS.ema50}
							hidden={hidden.ema50}
							onToggleHide={() => actions.toggleHidden("ema50")}
							onSettings={() => actions.setSettings("ema50")}
							onRemove={() => actions.removeIndicator("ema50")}
						/>
					)}
					{indicators.ema200 && (
						<IndicatorPill
							name={`EMA ${config.ema200}`}
							value={
								lastValues.ema200 ? formatPrice(lastValues.ema200) : undefined
							}
							color={INDICATOR_COLORS.ema200}
							hidden={hidden.ema200}
							onToggleHide={() => actions.toggleHidden("ema200")}
							onSettings={() => actions.setSettings("ema200")}
							onRemove={() => actions.removeIndicator("ema200")}
						/>
					)}
				</div>
			</div>
			{indicators.rsi && paneOffsets[1] && (
				<div
					className="absolute left-3 pointer-events-none"
					style={{ top: paneOffsets[1].top + 6 }}
				>
					<IndicatorPill
						name="RSI"
						value={lastValues.rsi?.toFixed(2)}
						color={INDICATOR_COLORS.rsi}
						hidden={hidden.rsi}
						onToggleHide={() => actions.toggleHidden("rsi")}
						onSettings={() => actions.setSettings("rsi")}
						onRemove={() => actions.removeIndicator("rsi")}
					/>
				</div>
			)}
			{indicators.macd && paneOffsets[macdPaneIdx] && (
				<div
					className="absolute left-3 pointer-events-none"
					style={{ top: paneOffsets[macdPaneIdx].top + 6 }}
				>
					<IndicatorPill
						name="MACD"
						value={lastValues.macd?.toFixed(2)}
						color={INDICATOR_COLORS.macd}
						hidden={hidden.macd}
						onToggleHide={() => actions.toggleHidden("macd")}
						onSettings={() => actions.setSettings("macd")}
						onRemove={() => actions.removeIndicator("macd")}
					/>
				</div>
			)}
			{indicators.stochastic && paneOffsets[stochPaneIdx] && (
				<div
					className="absolute left-3 pointer-events-none"
					style={{ top: paneOffsets[stochPaneIdx].top + 6 }}
				>
					<IndicatorPill
						name="Stoch"
						value={lastValues.stochK?.toFixed(2)}
						color={INDICATOR_COLORS.stochastic}
						hidden={hidden.stochastic}
						onToggleHide={() => actions.toggleHidden("stochastic")}
						onSettings={() => actions.setSettings("stochastic")}
						onRemove={() => actions.removeIndicator("stochastic")}
					/>
				</div>
			)}
			{indicators.adx && paneOffsets[adxPaneIdx] && (
				<div
					className="absolute left-3 pointer-events-none"
					style={{ top: paneOffsets[adxPaneIdx].top + 6 }}
				>
					<IndicatorPill
						name="ADX"
						value={lastValues.adx?.toFixed(2)}
						color={INDICATOR_COLORS.adx}
						hidden={hidden.adx}
						onToggleHide={() => actions.toggleHidden("adx")}
						onSettings={() => actions.setSettings("adx")}
						onRemove={() => actions.removeIndicator("adx")}
					/>
				</div>
			)}
		</div>
	);
}
