"use client";

import { useEffect, useState } from "react";
import type { Drawing, DrawingManager, DrawingStyle } from "lightweight-charts-drawing";
import { Lock, PaintBucket, Settings2, Trash2, Type, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LINE_STYLES, drawingOptions, linePatch } from "@/lib/chart/drawing-options";
import { resetToFactory, restyle } from "@/lib/chart/remembered-style";
import { DrawingSettings, FillControls, LineControls, Swatches, type LineChange } from "./DrawingSettings";

// Long enough to notice a wrong tap, short enough not to linger.
const UNDO_MS = 5000;

const barClass =
	"absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded border border-line bg-surface p-1 shadow-[var(--shadow-pop)]";
const actionClass =
	"grid h-8 min-w-8 shrink-0 place-items-center rounded px-1.5 text-ink-2 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:h-11 max-[819px]:min-w-11";

/**
 * The selected drawing's actions (odd/tasks/grafico-celular.md S3). The drawing layer edits a
 * drawing with the Delete key, a double click and a right click, none of which a phone has.
 * Fondo and ⚙ (every option of its tool) come from odd/tasks/chart-customization.md S2.
 */
export function DrawingActions({ manager, onEditText }: { manager: DrawingManager | null; onEditText: (drawing: Drawing) => void }) {
	const [selected, setSelected] = useState<Drawing[]>([]);
	// The drawings just deleted, offered back in this same bar: a toast at the bottom of a
	// phone would sit over the next thing the finger taps (the Dibujar list, this bar).
	const [deleted, setDeleted] = useState<Drawing[] | null>(null);
	// The drawing whose settings are open: they close when another one is selected.
	const [settingsFor, setSettingsFor] = useState<string | null>(null);

	useEffect(() => {
		if (!manager) return;
		const read = () => {
			const now = manager.selection().map((id) => manager.get(id)).filter((d): d is Drawing => d !== undefined);
			setSelected(now);
			if (now.length > 0) setDeleted(null);
		};
		const offs = [manager.on("selection", read), manager.on("change", read)];
		return () => offs.forEach((off) => off());
	}, [manager]);

	useEffect(() => {
		if (!deleted) return;
		const timer = setTimeout(() => setDeleted(null), UNDO_MS);
		return () => clearTimeout(timer);
	}, [deleted]);

	if (!manager) return null;
	if (selected.length === 0) {
		if (!deleted) return null;
		const what = deleted.length === 1 ? "Dibujo borrado" : "Dibujos borrados";
		return (
			<div role="status" aria-label={what} className={cn(barClass, "gap-2 pl-3 text-[13px] text-ink")}>
				{what}
				<button
					type="button"
					onClick={() => {
						deleted.forEach((d) => manager.add(d));
						setDeleted(null);
					}}
					className={cn(actionClass, "px-3 font-medium text-accent-ink")}
				>
					Deshacer
				</button>
			</div>
		);
	}
	const first = selected[0];
	const one = selected.length === 1;
	const options = drawingOptions(first.kind);
	// Every change becomes the style of its tool (S2): the next drawing comes out the same.
	const onLine = (change: LineChange) => restyle(manager, selected, (d) => linePatch(d, change));
	const onStyle = (style: Partial<DrawingStyle>) => restyle(manager, [first], () => style);
	const remove = () => {
		selected.forEach((d) => manager.remove(d.id));
		setDeleted(selected);
	};

	return (
		// Seven actions at 44px are wider than a 320px chart: the bar wraps to a second row there instead of
		// hiding "Listo" behind a scroll (odd/tasks/chart-customization.md S8); where they fit it is one row as always.
		<div role="toolbar" aria-label="Dibujo seleccionado" className={cn(barClass, "w-max flex-wrap justify-center")}>
			<Popover>
				<PopoverTrigger aria-label="Color" title="Color" className={actionClass}>
					<span className="h-[18px] w-[18px] rounded-full border border-line-strong" style={{ background: first.style.color }} aria-hidden />
				</PopoverTrigger>
				<PopoverContent className="w-auto p-2">
					<Swatches label="Color" value={first.style.color} onPick={(color) => onLine({ color })} className="w-auto grid-cols-4 max-[819px]:grid-cols-4" />
				</PopoverContent>
			</Popover>

			{one && options?.fill && (
				<Popover>
					<PopoverTrigger aria-label="Fondo" title="Fondo" className={actionClass}>
						<PaintBucket className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
					</PopoverTrigger>
					<PopoverContent className="w-auto p-3">
						<FillControls drawing={first} onStyle={onStyle} />
					</PopoverContent>
				</Popover>
			)}

			<Popover>
				<PopoverTrigger aria-label="Línea" title="Línea" className={actionClass}>
					<svg width="22" height="18" aria-hidden>
						<line x1="2" y1="9" x2="20" y2="9" stroke="currentColor" strokeWidth={first.style.width} strokeDasharray={LINE_STYLES.find((s) => s.value === first.style.lineStyle)?.dash} />
					</svg>
				</PopoverTrigger>
				<PopoverContent className="flex w-auto flex-col gap-1 p-2">
					<LineControls style={first.style} onLine={onLine} />
				</PopoverContent>
			</Popover>

			{one && first.kind === "text" && (
				<button type="button" aria-label="Editar texto" title="Editar texto" onClick={() => onEditText(first)} className={actionClass}>
					<Type className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
				</button>
			)}
			{one && options && (
				<button type="button" aria-label="Configuración" title="Configuración" onClick={() => setSettingsFor(first.id)} className={actionClass}>
					<Settings2 className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
				</button>
			)}
			<button
				type="button"
				aria-label={first.locked ? "Desbloquear" : "Bloquear"}
				title={first.locked ? "Desbloquear: se puede mover" : "Bloquear: que no se mueva"}
				aria-pressed={!!first.locked}
				onClick={() => selected.forEach((d) => manager.update({ ...d, locked: !first.locked }))}
				className={cn(actionClass, first.locked && "bg-accent-soft text-accent-ink")}
			>
				{first.locked ? <Lock className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden /> : <Unlock className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />}
			</button>
			<button type="button" aria-label="Borrar dibujo" title="Borrar dibujo" onClick={remove} className={cn(actionClass, "text-danger hover:bg-danger-soft hover:text-danger")}>
				<Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
			</button>
			<span className="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden />
			<button type="button" aria-label="Listo" onClick={() => manager.select([])} className={cn(actionClass, "px-3 text-[13px] font-medium text-ink")}>
				Listo
			</button>
			{one && (
				<DrawingSettings
					drawing={first}
					open={settingsFor === first.id}
					onOpenChange={(open) => setSettingsFor(open ? first.id : null)}
					onStyle={onStyle}
					onReset={() => resetToFactory(manager, first)}
				/>
			)}
		</div>
	);
}
