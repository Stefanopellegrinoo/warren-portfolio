import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import { INDICATOR_COLORS, type IndicatorConfig, type IndicatorKey } from "@/lib/store/chart-store";
import type { IndicatorPoint } from "@/lib/indicators";
import { formatNumber } from "@/lib/utils";
import { INDICATOR_SPECS, type IndicatorLine } from "./indicator-specs";
import {
	INDICATOR_VALUE_BOUNDS,
	type ChartPreferences,
	type IndicatorLineStyle,
	type IndicatorStyle,
} from "./preferences-schema";

/**
 * An indicator's saved settings (odd/tasks/chart-customization.md S5) as the chart draws them. Whatever the
 * user never changed keeps today's look: the colors of INDICATOR_SPECS, width 1, the levels in the theme's
 * color (S8); only RSI's fill is on by default (odd/tasks/chart-pro-redesign.md S1).
 */

type Saved = ChartPreferences["indicatorSettings"];

/** This device's values under the settings saved in the account: an indicator's saved values win (S4). */
export function effectiveConfig(device: IndicatorConfig, saved: Saved): IndicatorConfig {
	return Object.assign({ ...device }, ...Object.values(saved).map((s) => s?.values ?? {}));
}

/** The values one indicator uses (its fields of IndicatorConfig). */
export function indicatorValues(key: IndicatorKey, config: IndicatorConfig): Partial<IndicatorConfig> {
	return Object.fromEntries(Object.keys(INDICATOR_VALUE_BOUNDS[key]).map((f) => [f, config[f as keyof IndicatorConfig]]));
}

export type LineLook = Required<Omit<IndicatorLineStyle, "width">> & { width: 1 | 2 | 3 | 4 };

/** A line or histogram as drawn: its factory color and width 1 under what the user saved. */
export function lineLook(line: IndicatorLine, saved?: IndicatorLineStyle): LineLook {
	return {
		color: saved?.color ?? line.color,
		width: (saved?.width ?? 1) as LineLook["width"],
		visible: saved?.visible ?? true,
		upColor: saved?.upColor ?? line.upColor ?? line.color,
		downColor: saved?.downColor ?? line.downColor ?? line.color,
	};
}

/** The series data; a histogram's bars carry their own color only while rising and falling differ. */
export function seriesPoints(line: IndicatorLine, look: LineLook): (IndicatorPoint & { color?: string })[] {
	if (line.type !== "histogram" || look.upColor === look.downColor) return line.data.map((p) => ({ time: p.time, value: p.value }));
	return line.data.map((p, i) => ({ time: p.time, value: p.value, color: line.up?.[i] === false ? look.downColor : look.upColor }));
}

/** The levels (RSI's 30 and 70), in INDICATOR_SPECS' order; `color` is the theme's, as today. */
export function levelLooks(key: IndicatorKey, style: IndicatorStyle | undefined, color: string) {
	return (INDICATOR_SPECS[key].levels ?? []).map((value, i) => {
		const saved = style?.levels?.[i];
		return { value: saved?.value ?? value, color: saved?.color ?? color, visible: saved?.visible ?? true };
	});
}

const FILL_COLORS: Record<string, string> = { bands: INDICATOR_COLORS.bollinger, levels: INDICATOR_COLORS.rsi };

/** A fill: RSI's 30–70 on until the user turns it off (odd/tasks/chart-pro-redesign.md S1); Bollinger's off until turned on. */
export function fillLook(id: string, style?: IndicatorStyle) {
	const saved = style?.fills?.[id];
	return { visible: saved?.visible ?? id === "levels", color: saved?.color ?? FILL_COLORS[id], transparency: saved?.transparency ?? 90 };
}

const compact = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });
/** A volume, briefly: "1,2 M" (a plain space where Intl puts a non-breaking one, and the app's minus sign). */
export function compactNumber(v: number) {
	return (v < 0 ? "−" : "") + compact.format(Math.abs(v)).replace(/\s/g, " ");
}

/** The format of an indicator pane's scale, from its spec's `axis`; null over the price, which reads like the price. */
export function axisFormat(key: IndicatorKey) {
	const axis = INDICATOR_SPECS[key].axis;
	if (axis === undefined) return null;
	if (axis === "compact") return { type: "custom" as const, formatter: compactNumber, minMove: 1 };
	return { type: "custom" as const, formatter: (p: number) => formatNumber(p, { decimals: axis }), minMove: 10 ** -axis };
}

/** A soft band between an indicator's levels that is always there and is not a setting: the stochastic's 20–80 (S1). */
export const FIXED_BANDS: Partial<Record<IndicatorKey, { color: string; transparency: number }>> = {
	stochastic: { color: INDICATOR_COLORS.stochastic, transparency: 94 },
};

type Edge = number | readonly IndicatorPoint[];
export interface FillDraw {
	visible: boolean;
	color: string;
	transparency: number;
	/** A price (a level) or a line's points (a band). */
	top: Edge;
	bottom: Edge;
}

/**
 * The fill between two edges of an indicator, under its lines: Bollinger's bands, RSI's levels. The chart has no
 * band series, so it is a primitive of the indicator's first series, drawn in that series' pane and price scale.
 */
export class BandFill implements ISeriesPrimitive<Time> {
	private look: FillDraw | null = null;
	private host: SeriesAttachedParameter<Time> | null = null;
	private readonly views: IPrimitivePaneView[] = [{ zOrder: () => "bottom", renderer: () => this.renderer() }];

	attached(host: SeriesAttachedParameter<Time>) {
		this.host = host;
	}
	detached() {
		this.host = null;
	}
	paneViews() {
		return this.views;
	}
	update(look: FillDraw) {
		this.look = look;
		this.host?.requestUpdate();
	}

	private renderer(): IPrimitivePaneRenderer | null {
		const { look, host } = this;
		if (!look?.visible || !host) return null;
		const x = (t: number) => host.chart.timeScale().timeToCoordinate(t as Time);
		const y = (p: number) => host.series.priceToCoordinate(p);
		return {
			draw: (target) =>
				target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
					ctx.save();
					ctx.fillStyle = look.color;
					ctx.globalAlpha = 1 - look.transparency / 100;
					if (typeof look.top === "number" && typeof look.bottom === "number") {
						const a = y(look.top);
						const b = y(look.bottom);
						if (a !== null && b !== null) ctx.fillRect(0, Math.min(a, b), mediaSize.width, Math.abs(b - a));
					} else if (typeof look.top !== "number" && typeof look.bottom !== "number") {
						// ponytail: every point, every frame (~2 per candle); clip to the visible range if it ever shows.
						const along = [...look.top, ...[...look.bottom].reverse()];
						ctx.beginPath();
						let started = false;
						for (const p of along) {
							const px = x(p.time);
							const py = y(p.value);
							if (px === null || py === null) continue;
							if (started) ctx.lineTo(px, py);
							else ctx.moveTo(px, py);
							started = true;
						}
						ctx.closePath();
						ctx.fill();
					}
					ctx.restore();
				}),
		};
	}
}
