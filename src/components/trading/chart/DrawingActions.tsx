"use client";

import { useEffect, useState } from "react";
import type { Drawing, DrawingManager, DrawingStyle } from "lightweight-charts-drawing";
import { Check, Lock, Trash2, Type, Unlock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// TradingView's drawing palette.
const COLORS = [
	{ value: "#2962ff", label: "azul" },
	{ value: "#089981", label: "verde" },
	{ value: "#f23645", label: "rojo" },
	{ value: "#ff9800", label: "naranja" },
	{ value: "#9c27b0", label: "violeta" },
	{ value: "#00bcd4", label: "celeste" },
	{ value: "#787b86", label: "gris" },
	{ value: "#131722", label: "negro" },
];
const WIDTHS = [1, 2, 3, 4];
const LINE_STYLES: { value: DrawingStyle["lineStyle"]; label: string; dash?: string }[] = [
	{ value: "solid", label: "Sólida" },
	{ value: "dashed", label: "Discontinua", dash: "6 4" },
	{ value: "dotted", label: "Punteada", dash: "2 3" },
];

const actionClass =
	"grid h-8 min-w-8 place-items-center rounded px-1.5 text-ink-2 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:h-11 max-[819px]:min-w-11";
const optionClass = "grid h-8 place-items-center rounded hover:bg-hover max-[819px]:h-11";

/**
 * The selected drawing's actions (odd/tasks/grafico-celular.md S3). The drawing layer edits a
 * drawing with the Delete key, a double click and a right click, none of which a phone has.
 */
export function DrawingActions({ manager, onEditText }: { manager: DrawingManager | null; onEditText: (drawing: Drawing) => void }) {
	const [selected, setSelected] = useState<Drawing[]>([]);

	useEffect(() => {
		if (!manager) return;
		const read = () => setSelected(manager.selection().map((id) => manager.get(id)).filter((d): d is Drawing => d !== undefined));
		const offs = [manager.on("selection", read), manager.on("change", read)];
		return () => offs.forEach((off) => off());
	}, [manager]);

	if (!manager || selected.length === 0) return null;
	const first = selected[0];
	const restyle = (style: Partial<DrawingStyle>) => selected.forEach((d) => manager.update({ ...d, style: { ...d.style, ...style } }));
	const remove = () => {
		selected.forEach((d) => manager.remove(d.id));
		toast(selected.length === 1 ? "Dibujo borrado" : "Dibujos borrados", {
			action: { label: "Deshacer", onClick: () => selected.forEach((d) => manager.add(d)) },
		});
	};

	return (
		<div
			role="toolbar"
			aria-label="Dibujo seleccionado"
			className="absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
		>
			<Popover>
				<PopoverTrigger aria-label="Color" title="Color" className={actionClass}>
					<span className="h-[18px] w-[18px] rounded-full border border-line-strong" style={{ background: first.style.color }} aria-hidden />
				</PopoverTrigger>
				<PopoverContent className="grid w-auto grid-cols-4 gap-1 p-2">
					{COLORS.map((c) => (
						<button key={c.value} type="button" aria-label={`Color ${c.label}`} onClick={() => restyle({ color: c.value, textColor: c.value })} className={cn(optionClass, "w-8 max-[819px]:w-11")}>
							<span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: c.value }} aria-hidden>
								{first.style.color === c.value && <Check className="h-3.5 w-3.5 text-white" aria-hidden />}
							</span>
						</button>
					))}
				</PopoverContent>
			</Popover>

			<Popover>
				<PopoverTrigger aria-label="Línea" title="Línea" className={actionClass}>
					<svg width="22" height="18" aria-hidden>
						<line x1="2" y1="9" x2="20" y2="9" stroke="currentColor" strokeWidth={first.style.width} strokeDasharray={LINE_STYLES.find((s) => s.value === first.style.lineStyle)?.dash} />
					</svg>
				</PopoverTrigger>
				<PopoverContent className="flex w-auto flex-col gap-1 p-2">
					<div className="flex gap-1">
						{WIDTHS.map((w) => (
							<button key={w} type="button" aria-label={`Grosor ${w}`} aria-pressed={first.style.width === w} onClick={() => restyle({ width: w })} className={cn(optionClass, "w-10 max-[819px]:w-11", first.style.width === w && "bg-accent-soft")}>
								<span className="w-6 rounded-full bg-ink" style={{ height: w }} aria-hidden />
							</button>
						))}
					</div>
					{LINE_STYLES.map((s) => (
						<button key={s.value} type="button" aria-label={s.label} aria-pressed={first.style.lineStyle === s.value} onClick={() => restyle({ lineStyle: s.value })} className={cn(optionClass, "flex gap-2 px-2 text-[13px] text-ink", first.style.lineStyle === s.value && "bg-accent-soft")}>
							<svg width="28" height="4" aria-hidden><line x1="0" y1="2" x2="28" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray={s.dash} /></svg>
							{s.label}
						</button>
					))}
				</PopoverContent>
			</Popover>

			{selected.length === 1 && first.kind === "text" && (
				<button type="button" aria-label="Editar texto" title="Editar texto" onClick={() => onEditText(first)} className={actionClass}>
					<Type className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
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
		</div>
	);
}
