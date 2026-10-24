"use client";

import { useEffect, useState } from "react";
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

export const TOOL_LABELS: Partial<Record<DrawingKind, string>> = Object.fromEntries(
	GROUPS.flat().map((t) => [t.kind, t.label]),
);

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

const Divider = () => <span className="h-px w-6 shrink-0 bg-line max-[819px]:h-6 max-[819px]:w-px" aria-hidden />;

/**
 * The drawing toolbar: a vertical strip on desktop, a horizontal scroller on
 * phones. It reads and drives the DrawingManager; the alert tool is the
 * chart's own, passed in.
 */
export function DrawingTools({
	manager,
	alertMode,
	onAlertMode,
}: {
	manager: DrawingManager | null;
	alertMode: boolean;
	onAlertMode: (on: boolean) => void;
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

	return (
		<div
			role="toolbar"
			aria-label="Herramientas de dibujo"
			aria-orientation="vertical"
			className="flex shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-line bg-surface px-1 py-2 max-[819px]:flex-row max-[819px]:overflow-x-auto max-[819px]:overflow-y-hidden max-[819px]:border-b max-[819px]:border-r-0 max-[819px]:px-2 max-[819px]:py-1"
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
				onClick={() => {
					manager?.setMagnet(magnet ? "off" : "weak");
					setMagnet(!magnet);
				}}
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
	);
}
