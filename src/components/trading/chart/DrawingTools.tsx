"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DrawingKind, DrawingManager } from "lightweight-charts-drawing";
import {
	ArrowRightToLine,
	Bell,
	Brush,
	Columns2,
	Eye,
	EyeOff,
	GitCommitHorizontal,
	Magnet,
	Minus,
	MousePointer2,
	MoveHorizontal,
	MoveUpRight,
	Pencil,
	Percent,
	RectangleHorizontal,
	Rows3,
	Ruler,
	SeparatorVertical,
	Slash,
	Trash2,
	TrendingDown,
	TrendingUp,
	Type,
	type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { barButton } from "@/components/trading/ui";

interface Tool {
	kind: DrawingKind;
	label: string;
	icon: LucideIcon;
}

// The tools a stock chart needs day to day, grouped like TradingView's left bar.
const GROUPS: Tool[][] = [
	[
		{ kind: "trend-line", label: "Línea de tendencia", icon: Slash },
		{ kind: "ray", label: "Rayo", icon: MoveUpRight },
		{ kind: "extended-line", label: "Línea extendida", icon: MoveHorizontal },
		{ kind: "horizontal-line", label: "Línea horizontal", icon: Minus },
		{ kind: "horizontal-ray", label: "Rayo horizontal", icon: ArrowRightToLine },
		{ kind: "vertical-line", label: "Línea vertical", icon: SeparatorVertical },
	],
	[
		{ kind: "parallel-channel", label: "Canal paralelo", icon: Columns2 },
		{ kind: "fib-retracement", label: "Retroceso de Fibonacci", icon: Rows3 },
		{ kind: "trend-based-fib-extension", label: "Extensión de Fibonacci", icon: GitCommitHorizontal },
	],
	[
		{ kind: "rectangle", label: "Rectángulo", icon: RectangleHorizontal },
		{ kind: "brush", label: "Pincel", icon: Brush },
		{ kind: "text", label: "Texto", icon: Type },
	],
	[
		{ kind: "price-range", label: "Rango de precio", icon: Percent },
		{ kind: "date-and-price-range", label: "Rango de fecha y precio", icon: Ruler },
		{ kind: "long-position", label: "Posición larga", icon: TrendingUp },
		{ kind: "short-position", label: "Posición corta", icon: TrendingDown },
	],
];

const GROUP_NAMES = ["Líneas", "Canales y Fibonacci", "Formas y texto", "Medir y posiciones"];

export const TOOL_LABELS: Partial<Record<DrawingKind, string>> = Object.fromEntries(
	GROUPS.flat().map((t) => [t.kind, t.label]),
);

const ONE_POINT: DrawingKind[] = ["horizontal-line", "horizontal-ray", "vertical-line", "text", "long-position", "short-position"];
const THREE_POINTS: DrawingKind[] = ["parallel-channel", "trend-based-fib-extension"];

/** What to do with the armed tool, said where a phone user looks: there is no hover hint. */
function toolHint(kind: DrawingKind) {
	if (ONE_POINT.includes(kind)) return "Tocá en el gráfico";
	if (kind === "brush") return "Arrastrá en el gráfico";
	if (THREE_POINTS.includes(kind)) return "Arrastrá y después tocá el tercer punto";
	return "Tocá dos puntos o arrastrá";
}

const toolClass =
	"grid h-8 w-8 shrink-0 place-items-center rounded text-ink-2 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:h-11 max-[819px]:w-11";

function ToolButton({
	label,
	icon: Icon,
	active,
	onClick,
}: {
	label: string;
	icon: LucideIcon;
	active?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			aria-pressed={active}
			onClick={onClick}
			className={cn(toolClass, active && "bg-accent-soft text-accent-ink hover:bg-accent-soft hover:text-accent-ink")}
		>
			<Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
		</button>
	);
}

const rowButton = cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-11 shrink-0 gap-2 px-3 text-[14px]");
const listButton = "flex h-11 items-center gap-2 rounded px-2 text-left text-[14px] text-ink hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

/**
 * Below 820px the 21 icons do not fit and have no names (a phone shows no tooltip): one
 * "Dibujar" list with every tool by its name, the alert, and, while a tool is armed, what to
 * do with it and Cancelar over the whole bar, because a phone has no Esc
 * (odd/tasks/grafico-celular.md S5). They sit in the page's bottom bar (odd/tasks/grafico-espacio.md S3-S4).
 */
function PhoneTools({
	manager,
	tool,
	magnet,
	visible,
	alertMode,
	arm,
	onAlertMode,
	onMagnet,
}: {
	manager: DrawingManager | null;
	tool: DrawingKind | null;
	magnet: boolean;
	visible: boolean;
	alertMode: boolean;
	arm: (kind: DrawingKind | null) => void;
	onAlertMode: (on: boolean) => void;
	onMagnet: () => void;
}) {
	const [open, setOpen] = useState(false);
	const armed = tool ? GROUPS.flat().find((t) => t.kind === tool) : undefined;
	const toggleVisible = (
		<button type="button" className={listButton} onClick={() => manager?.setDrawingsVisible(!visible)}>
			{visible ? <EyeOff className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.75} aria-hidden /> : <Eye className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.75} aria-hidden />}
			{visible ? "Ocultar dibujos" : "Mostrar dibujos"}
		</button>
	);

	return (
		<div role="group" aria-label="Dibujos" className="flex flex-1">
			{alertMode || armed ? (
				<div className="absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-1 bg-surface px-2">
					<span className="grid h-11 w-11 shrink-0 place-items-center rounded bg-accent-soft text-accent-ink" aria-hidden>
						{armed ? <armed.icon className="h-[18px] w-[18px]" strokeWidth={1.75} /> : <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />}
					</span>
					<p role="status" className="min-w-0 flex-1 text-[13px] leading-tight">
						<span className="block truncate font-medium text-ink">{armed ? armed.label : "Alerta de precio"}</span>
						<span className="block truncate text-ink-3">{armed ? toolHint(armed.kind) : "Tocá el gráfico en el precio de la alerta"}</span>
					</p>
					<button type="button" className={rowButton} onClick={() => (armed ? arm(null) : onAlertMode(false))}>
						Cancelar
					</button>
				</div>
			) : (
				<>
					<Popover open={open} onOpenChange={setOpen}>
						<PopoverTrigger aria-label={visible ? undefined : "Dibujar (dibujos ocultos)"} className={barButton}>
							{visible ? <Pencil className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden /> : <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />}
							Dibujar
						</PopoverTrigger>
						<PopoverContent side="top" aria-label="Herramientas" className="max-h-[min(70vh,34rem)] w-[min(24rem,calc(100vw-16px))] overflow-y-auto p-2">
							{GROUPS.map((group, i) => (
								<section key={GROUP_NAMES[i]} aria-label={GROUP_NAMES[i]}>
									<h3 className="px-2 pb-1 pt-2 text-[12px] font-medium text-ink-3">{GROUP_NAMES[i]}</h3>
									<div className="grid grid-cols-2 gap-0.5">
										{group.map((t) => (
											<button
												key={t.kind}
												type="button"
												className={listButton}
												onClick={() => {
													setOpen(false);
													arm(t.kind);
												}}
											>
												<t.icon className="h-[18px] w-[18px] shrink-0 text-ink-2" strokeWidth={1.75} aria-hidden />
												{t.label}
											</button>
										))}
									</div>
								</section>
							))}
							<div className="mt-2 grid grid-cols-2 gap-0.5 border-t border-line pt-2">
								<button type="button" aria-pressed={magnet} className={cn(listButton, magnet && "bg-accent-soft")} onClick={onMagnet}>
									<Magnet className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.75} aria-hidden />
									Imán
								</button>
								{toggleVisible}
								<InlineConfirm
									question="¿Borrar todos los dibujos de este activo?"
									confirmLabel="Sí, borrar"
									onConfirm={() => {
										setOpen(false);
										manager?.clear();
									}}
									triggerClassName={cn(listButton, "text-danger")}
									className="col-span-2 px-2 py-1 text-[13px]"
								>
									Borrar todos
								</InlineConfirm>
							</div>
						</PopoverContent>
					</Popover>
					<button type="button" className={barButton} onClick={() => onAlertMode(true)}>
						<Bell className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
						Alerta
					</button>
				</>
			)}
		</div>
	);
}

const Divider = () => <span className="h-px w-6 shrink-0 bg-line max-[819px]:h-6 max-[819px]:w-px" aria-hidden />;

/**
 * The drawing toolbar: a vertical strip on desktop, the PhoneTools in the
 * page's bottom bar (`phoneBar`) on phones. It reads and drives the
 * DrawingManager; the alert tool is the chart's own, passed in.
 */
export function DrawingTools({
	manager,
	alertMode,
	onAlertMode,
	phoneBar = null,
}: {
	manager: DrawingManager | null;
	alertMode: boolean;
	onAlertMode: (on: boolean) => void;
	phoneBar?: HTMLElement | null;
}) {
	const [tool, setTool] = useState<DrawingKind | null>(null);
	const [magnet, setMagnet] = useState(false);
	const [visible, setVisible] = useState(true);
	const [askingClear, setAskingClear] = useState(false);

	useEffect(() => {
		if (!manager) return;
		const offTool = manager.on("tool", setTool);
		const offVis = manager.on("visibility", setVisible);
		return () => {
			offTool();
			offVis();
		};
	}, [manager]);

	const arm = (kind: DrawingKind | null) => {
		onAlertMode(false);
		manager?.setTool(kind);
	};

	const toggleMagnet = () => {
		manager?.setMagnet(magnet ? "off" : "weak");
		setMagnet(!magnet);
	};

	return (
		<>
		{phoneBar && createPortal(<PhoneTools manager={manager} tool={tool} magnet={magnet} visible={visible} alertMode={alertMode} arm={arm} onAlertMode={onAlertMode} onMagnet={toggleMagnet} />, phoneBar)}
		<div
			role="toolbar"
			aria-label="Herramientas de dibujo"
			aria-orientation="vertical"
			className="flex shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-line bg-surface px-1 py-2 max-[819px]:hidden"
		>
			<ToolButton label="Cursor" icon={MousePointer2} active={tool === null && !alertMode} onClick={() => arm(null)} />
			{GROUPS.map((group, i) => (
				<div key={i} className="contents">
					<Divider />
					{group.map((t) => (
						<ToolButton key={t.kind} label={t.label} icon={t.icon} active={tool === t.kind} onClick={() => arm(tool === t.kind ? null : t.kind)} />
					))}
				</div>
			))}
			<Divider />
			<ToolButton
				label="Alerta de precio: tocá el gráfico en el precio"
				icon={Bell}
				active={alertMode}
				onClick={() => {
					manager?.setTool(null);
					onAlertMode(!alertMode);
				}}
			/>
			<Divider />
			<ToolButton
				label={magnet ? "Imán activado" : "Imán"}
				icon={Magnet}
				active={magnet}
				onClick={toggleMagnet}
			/>
			<ToolButton
				label={visible ? "Ocultar dibujos" : "Mostrar dibujos"}
				icon={visible ? Eye : EyeOff}
				active={!visible}
				onClick={() => manager?.setDrawingsVisible(!visible)}
			/>
			{/* InlineConfirm's question would widen the 40px vertical strip and shift the chart: same two steps in a popover. */}
			<Popover open={askingClear} onOpenChange={(open) => setAskingClear(open && !!manager && manager.drawings().length > 0)}>
				<PopoverTrigger title="Borrar todos los dibujos" aria-label="Borrar todos los dibujos" className={toolClass}>
					<Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
				</PopoverTrigger>
				<PopoverContent className="flex w-[min(16rem,calc(100vw-32px))] flex-col gap-2 p-3">
					<p className="text-[13px] font-medium text-danger">¿Borrar todos los dibujos de este activo?</p>
					<div className="flex flex-wrap justify-end gap-2">
						<button
							type="button"
							className={cn(buttonVariants({ variant: "destructive", size: "sm" }), "max-[819px]:h-11")}
							onClick={() => {
								setAskingClear(false);
								manager?.clear();
							}}
						>
							Sí, borrar
						</button>
						<button type="button" autoFocus className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-[819px]:h-11")} onClick={() => setAskingClear(false)}>
							Cancelar
						</button>
					</div>
				</PopoverContent>
			</Popover>
		</div>
		</>
	);
}
