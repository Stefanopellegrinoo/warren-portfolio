import { factoryStyleFor, type Drawing, type DrawingKind, type DrawingStyle } from "lightweight-charts-drawing";

/**
 * What each drawing tool lets the user change (odd/tasks/chart-customization.md S2), after
 * TradingView's settings for that tool, over what the drawing library draws (DrawingStyle).
 */

// TradingView's drawing palette.
export const COLORS = [
	{ value: "#2962ff", label: "azul" },
	{ value: "#089981", label: "verde" },
	{ value: "#f23645", label: "rojo" },
	{ value: "#ff9800", label: "naranja" },
	{ value: "#9c27b0", label: "violeta" },
	{ value: "#00bcd4", label: "celeste" },
	{ value: "#787b86", label: "gris" },
	{ value: "#131722", label: "negro" },
];
export const WIDTHS = [1, 2, 3, 4];
export type LineStyle = DrawingStyle["lineStyle"];
export const LINE_STYLES: { value: LineStyle; label: string; dash?: string }[] = [
	{ value: "solid", label: "Sólida" },
	{ value: "dashed", label: "Discontinua", dash: "6 4" },
	{ value: "dotted", label: "Punteada", dash: "2 3" },
];
export const FONT_SIZES = [10, 12, 14, 16, 20, 24, 28];

export type Section = "line" | "levels" | "fill" | "middle" | "extend" | "text";
/** The fill's own color; a Fibonacci tool's bands take its level colors, a position's zones are its stop and target. */
export type Fill = "color" | "levels" | "position";

interface Options {
	sections: Section[];
	fill?: Fill;
	/** The footer's "… salen con este estilo." */
	next: string;
}

const LINE: Section[] = ["line", "extend"];
const FIB: Section[] = ["line", "levels", "fill", "extend"];

const OPTIONS: Partial<Record<DrawingKind, Options>> = {
	"trend-line": { sections: LINE, next: "Las próximas líneas de tendencia" },
	ray: { sections: LINE, next: "Los próximos rayos" },
	"extended-line": { sections: LINE, next: "Las próximas líneas extendidas" },
	"horizontal-line": { sections: ["line"], next: "Las próximas líneas horizontales" },
	"horizontal-ray": { sections: ["line"], next: "Los próximos rayos horizontales" },
	"vertical-line": { sections: ["line"], next: "Las próximas líneas verticales" },
	"parallel-channel": { sections: ["line", "fill", "middle", "extend"], fill: "color", next: "Los próximos canales" },
	"fib-retracement": { sections: FIB, fill: "levels", next: "Los próximos retrocesos de Fibonacci" },
	"trend-based-fib-extension": { sections: FIB, fill: "levels", next: "Las próximas extensiones de Fibonacci" },
	rectangle: { sections: ["line", "fill", "middle", "extend"], fill: "color", next: "Los próximos rectángulos" },
	brush: { sections: ["line"], next: "Los próximos trazos de pincel" },
	text: { sections: ["text"], next: "Los próximos textos" },
	"price-range": { sections: ["line", "fill"], fill: "color", next: "Los próximos rangos de precio" },
	"date-and-price-range": { sections: ["line", "fill"], fill: "color", next: "Los próximos rangos de fecha y precio" },
	"long-position": { sections: ["line", "fill"], fill: "position", next: "Las próximas posiciones largas" },
	"short-position": { sections: ["line", "fill"], fill: "position", next: "Las próximas posiciones cortas" },
};

/** The options of a drawing's tool; none for kinds the app does not offer (they keep the plain bar). */
export const drawingOptions = (kind: DrawingKind): Options | undefined => OPTIONS[kind];

/** A style field as the drawing shows it: its own value, else its tool's factory one (an old ray has no extendRight). */
export function shown<K extends keyof DrawingStyle>(d: Drawing, key: K): DrawingStyle[K] {
	return d.style[key] ?? factoryStyleFor(d.kind)[key];
}

// A channel draws its lines from its levels: the borders at 0 and 1, the middle line at 0.5.
const isBorder = (coeff: number) => coeff === 0 || coeff === 1;

/** The style change for a new line color, width or style (the bar's and the settings' Línea). */
export function linePatch(d: Drawing, change: { color?: string; width?: number; lineStyle?: LineStyle }): Partial<DrawingStyle> {
	// The color goes to the text too, as the bar always did.
	const patch: Partial<DrawingStyle> = { ...change, ...(change.color && { textColor: change.color }) };
	if (d.kind === "parallel-channel" && d.style.levels) {
		patch.levels = d.style.levels.map((l) => ({
			...l,
			...(change.color && { color: change.color }),
			...(isBorder(l.coeff) && change.width && { width: change.width }),
			...(isBorder(l.coeff) && change.lineStyle && { style: change.lineStyle }),
		}));
	}
	return patch;
}

/** Whether the drawing shows its middle line (a channel's 0.5 level, a rectangle's middle line). */
export function middleLine(d: Drawing): boolean {
	if (d.kind === "rectangle") return !!shown(d, "rectMiddleLine")?.visible;
	return !!d.style.levels?.find((l) => l.coeff === 0.5)?.visible;
}

export function middleLinePatch(d: Drawing, visible: boolean): Partial<DrawingStyle> {
	if (d.kind === "rectangle") {
		// The rectangle's factory style always has one.
		return { rectMiddleLine: { ...shown(d, "rectMiddleLine")!, visible } };
	}
	return { levels: d.style.levels?.map((l) => (l.coeff === 0.5 ? { ...l, visible } : l)) };
}
