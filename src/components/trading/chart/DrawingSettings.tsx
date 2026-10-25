"use client";

import type { Drawing, DrawingStyle, LevelDef } from "lightweight-charts-drawing";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ghostButton } from "@/components/trading/ui";
import {
	COLORS,
	FONT_SIZES,
	LINE_STYLES,
	WIDTHS,
	drawingOptions,
	linePatch,
	middleLine,
	middleLinePatch,
	shown,
	type LineStyle,
	type Section,
} from "@/lib/chart/drawing-options";
import { TOOL_LABELS } from "./DrawingTools";
import { ChartSheet } from "./ChartSheet";

type OnStyle = (patch: Partial<DrawingStyle>) => void;
export type LineChange = { color?: string; width?: number; lineStyle?: LineStyle };

const optionClass = "grid h-8 place-items-center rounded hover:bg-hover max-[819px]:h-11";
const rowClass = "flex min-h-9 cursor-pointer items-center gap-2 text-[14px] text-ink max-[819px]:min-h-11";
const checkClass = "h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]";

/** The palette; `label` names what it colors ("Color de fondo" gives "Color de fondo rojo"). */
export function Swatches({ label, value, onPick, className }: { label: string; value?: string; onPick: (color: string) => void; className?: string }) {
	return (
		<div className={cn("grid w-max grid-cols-8 gap-1 max-[819px]:grid-cols-4", className)}>
			{COLORS.map((c) => (
				<button key={c.value} type="button" aria-label={`${label} ${c.label}`} onClick={() => onPick(c.value)} className={cn(optionClass, "w-8 max-[819px]:w-11")}>
					<span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: c.value }} aria-hidden>
						{value === c.value && <Check className="h-3.5 w-3.5 text-white" aria-hidden />}
					</span>
				</button>
			))}
		</div>
	);
}

/** Thickness and line style, as the bar's Línea always showed them; `row` lays the styles side by side. */
export function LineControls({ style, onLine, row }: { style: DrawingStyle; onLine: (change: LineChange) => void; row?: boolean }) {
	return (
		<>
			<div className="flex gap-1">
				{WIDTHS.map((w) => (
					<button key={w} type="button" aria-label={`Grosor ${w}`} aria-pressed={style.width === w} onClick={() => onLine({ width: w })} className={cn(optionClass, "w-10 max-[819px]:w-11", style.width === w && "bg-accent-soft")}>
						<span className="w-6 rounded-full bg-ink" style={{ height: w }} aria-hidden />
					</button>
				))}
			</div>
			<div className={cn("flex gap-1", row ? "flex-wrap" : "flex-col")}>
				{LINE_STYLES.map((s) => (
					<button key={s.value} type="button" aria-label={s.label} aria-pressed={style.lineStyle === s.value} onClick={() => onLine({ lineStyle: s.value })} className={cn(optionClass, "flex gap-2 px-2 text-[13px] text-ink", style.lineStyle === s.value && "bg-accent-soft")}>
						<svg width="28" height="4" aria-hidden><line x1="0" y1="2" x2="28" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray={s.dash} /></svg>
						{s.label}
					</button>
				))}
			</div>
		</>
	);
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
	return (
		<label className={rowClass}>
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={checkClass} />
			{label}
		</label>
	);
}

function Transparency({ value, onChange }: { value: number; onChange: (value: number) => void }) {
	return (
		<div className={cn(rowClass, "cursor-default")}>
			<span className="shrink-0 text-ink-2">Transparencia</span>
			<input type="range" min={0} max={100} step={5} value={value} aria-label="Transparencia" onChange={(e) => onChange(Number(e.target.value))} className="min-w-24 flex-1 accent-[var(--accent)]" />
			<span className="w-10 shrink-0 text-right tabular-nums text-ink-2">{value} %</span>
		</div>
	);
}

const Caption = ({ children }: { children: React.ReactNode }) => <p className="pt-1 text-[13px] text-ink-2">{children}</p>;

/** A drawing's fill: the bar's Fondo, and the Fondo of its settings. */
export function FillControls({ drawing, onStyle }: { drawing: Drawing; onStyle: OnStyle }) {
	const fill = drawingOptions(drawing.kind)?.fill;
	if (fill === "position") {
		const transparency = shown(drawing, "stopTransparency") ?? 80;
		return (
			<div className="flex flex-col gap-1">
				<Caption>Stop</Caption>
				<Swatches label="Color del stop" value={shown(drawing, "stopColor")} onPick={(c) => onStyle({ stopColor: c })} />
				<Caption>Objetivo</Caption>
				<Swatches label="Color del objetivo" value={shown(drawing, "targetColor")} onPick={(c) => onStyle({ targetColor: c })} />
				<Transparency value={transparency} onChange={(t) => onStyle({ stopTransparency: t, targetTransparency: t })} />
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-1">
			<Toggle label="Fondo visible" checked={shown(drawing, "fillBackground") !== false} onChange={(on) => onStyle({ fillBackground: on })} />
			{/* A Fibonacci tool's bands take its level colors. */}
			{fill === "color" && <Swatches label="Color de fondo" value={drawing.style.backgroundColor ?? drawing.style.color} onPick={(c) => onStyle({ backgroundColor: c })} />}
			<Transparency value={shown(drawing, "transparency") ?? 80} onChange={(t) => onStyle({ transparency: t })} />
		</div>
	);
}

function Levels({ levels, onStyle }: { levels: LevelDef[]; onStyle: OnStyle }) {
	const change = (i: number, level: Partial<LevelDef>) => onStyle({ levels: levels.map((l, j) => (j === i ? { ...l, ...level } : l)) });
	return (
		<div className="grid grid-cols-2 gap-x-4">
			{levels.map((l, i) => (
				<div key={i} data-level className="flex items-center justify-between gap-2">
					<label className={rowClass}>
						<input type="checkbox" checked={l.visible} onChange={(e) => change(i, { visible: e.target.checked })} className={checkClass} />
						{l.coeff}
					</label>
					<input type="color" aria-label={`Color del nivel ${l.coeff}`} value={l.color} onChange={(e) => change(i, { color: e.target.value })} className="h-7 w-9 shrink-0 cursor-pointer rounded border border-line bg-surface p-0.5 max-[819px]:h-11 max-[819px]:w-11" />
				</div>
			))}
		</div>
	);
}

// The middle line is one switch: it needs no heading of its own.
const TITLES: Partial<Record<Section, string>> = { line: "Línea", levels: "Niveles", fill: "Fondo", extend: "Extender", text: "Texto" };

/**
 * Every option of the selected drawing's tool (odd/tasks/chart-customization.md S2), from the bar's
 * ⚙; a change applies at once and becomes the tool's style.
 */
export function DrawingSettings({
	drawing,
	open,
	onOpenChange,
	onStyle,
	onReset,
}: {
	drawing: Drawing;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onStyle: OnStyle;
	onReset: () => void;
}) {
	const options = drawingOptions(drawing.kind);
	if (!options) return null;
	const onLine = (change: LineChange) => onStyle(linePatch(drawing, change));
	const body: Record<Section, () => React.ReactNode> = {
		line: () => (
			<div className="flex flex-col gap-1">
				<Swatches label="Color de línea" value={drawing.style.color} onPick={(color) => onLine({ color })} />
				<LineControls style={drawing.style} onLine={onLine} row />
			</div>
		),
		levels: () => <Levels levels={drawing.style.levels ?? []} onStyle={onStyle} />,
		fill: () => <FillControls drawing={drawing} onStyle={onStyle} />,
		middle: () => <Toggle label="Línea del medio" checked={middleLine(drawing)} onChange={(on) => onStyle(middleLinePatch(drawing, on))} />,
		extend: () => (
			<>
				<Toggle label="Extender a la izquierda" checked={!!shown(drawing, "extendLeft")} onChange={(on) => onStyle({ extendLeft: on })} />
				<Toggle label="Extender a la derecha" checked={!!shown(drawing, "extendRight")} onChange={(on) => onStyle({ extendRight: on })} />
			</>
		),
		text: () => (
			<div className="flex flex-col gap-1">
				<Swatches label="Color del texto" value={drawing.style.textColor ?? drawing.style.color} onPick={(color) => onLine({ color })} />
				<label className={cn(rowClass, "cursor-default")}>
					<span className="text-ink-2">Tamaño</span>
					<select value={shown(drawing, "fontSize") ?? 14} onChange={(e) => onStyle({ fontSize: Number(e.target.value) })} className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink max-[819px]:h-11">
						{FONT_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
					</select>
				</label>
				<Toggle label="Negrita" checked={!!drawing.style.bold} onChange={(on) => onStyle({ bold: on })} />
				<Toggle label="Cursiva" checked={!!drawing.style.italic} onChange={(on) => onStyle({ italic: on })} />
			</div>
		),
	};

	return (
		<ChartSheet
			open={open}
			onOpenChange={onOpenChange}
			title={TOOL_LABELS[drawing.kind]}
			footer={
				<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
					<p className="text-[13px] text-ink-3">{options.next} salen con este estilo.</p>
					<button type="button" onClick={onReset} className={ghostButton}>Volver al de fábrica</button>
				</div>
			}
		>
			{options.sections.map((section) => (
				<section key={section} className="border-b border-line py-2 last:border-b-0">
					{TITLES[section] && <h3 className="pb-1 text-[12px] font-medium text-ink-3">{TITLES[section]}</h3>}
					{body[section]()}
				</section>
			))}
		</ChartSheet>
	);
}
