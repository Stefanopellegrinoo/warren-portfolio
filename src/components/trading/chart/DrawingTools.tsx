"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
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
	MoreHorizontal,
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
	Star,
	Trash2,
	TrendingDown,
	TrendingUp,
	Type,
	type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { barButton } from "@/components/trading/ui";
import type { ToolKind } from "@/lib/chart/preferences-schema";
import { readBar, saveBar } from "@/lib/chart/favorites-bar";
import type { ChartAlert } from "@/lib/chart/alerts";
import { useChartPreferences } from "./useChartPreferences";
import { FavoritesBar } from "./FavoritesBar";
import { AlertMenu } from "./AlertMenu";
import { PORTFOLIO_SERIES } from "@/lib/compare-series";

interface Tool {
	kind: ToolKind;
	label: string;
	icon: LucideIcon;
}

interface Group {
	name: string;
	tools: Tool[];
}

// The tools a stock chart needs day to day, in the five groups of the rail (odd/tasks/chart-pro-redesign.md S6),
// like TradingView's left bar. TOOL_KINDS (preferences-schema.ts) follows this order.
const GROUPS: Group[] = [
	{
		name: "Líneas",
		tools: [
			{ kind: "trend-line", label: "Línea de tendencia", icon: Slash },
			{ kind: "ray", label: "Rayo", icon: MoveUpRight },
			{ kind: "extended-line", label: "Línea extendida", icon: MoveHorizontal },
			{ kind: "horizontal-line", label: "Línea horizontal", icon: Minus },
			{ kind: "horizontal-ray", label: "Rayo horizontal", icon: ArrowRightToLine },
			{ kind: "vertical-line", label: "Línea vertical", icon: SeparatorVertical },
		],
	},
	{
		name: "Canales y Fibonacci",
		tools: [
			{ kind: "parallel-channel", label: "Canal paralelo", icon: Columns2 },
			{ kind: "fib-retracement", label: "Retroceso de Fibonacci", icon: Rows3 },
			{ kind: "trend-based-fib-extension", label: "Extensión de Fibonacci", icon: GitCommitHorizontal },
		],
	},
	{
		name: "Formas y texto",
		tools: [
			{ kind: "rectangle", label: "Rectángulo", icon: RectangleHorizontal },
			{ kind: "brush", label: "Pincel", icon: Brush },
			{ kind: "text", label: "Texto", icon: Type },
		],
	},
	{
		name: "Medición",
		tools: [
			{ kind: "price-range", label: "Rango de precio", icon: Percent },
			{ kind: "date-and-price-range", label: "Rango de fecha y precio", icon: Ruler },
		],
	},
	{
		name: "Posiciones",
		tools: [
			{ kind: "long-position", label: "Posición larga", icon: TrendingUp },
			{ kind: "short-position", label: "Posición corta", icon: TrendingDown },
		],
	},
];
const TOOLS = GROUPS.flatMap((g) => g.tools);

export const TOOL_LABELS: Partial<Record<DrawingKind, string>> = Object.fromEntries(
	TOOLS.map((t) => [t.kind, t.label]),
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
const activeClass = "bg-accent-soft text-accent-ink hover:bg-accent-soft hover:text-accent-ink";

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
			className={cn(toolClass, active && activeClass)}
		>
			<Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
		</button>
	);
}

const rowButton = cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-11 shrink-0 gap-2 px-3 text-[14px]");
const listButton = "flex h-11 items-center gap-2 rounded px-2 text-left text-[14px] text-ink hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
const starButton =
	"grid h-9 w-9 shrink-0 place-items-center rounded hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:h-11 max-[819px]:w-11";

interface Favorites {
	starred: Partial<Record<ToolKind, true>>;
	onStar: (kind: ToolKind, starred: boolean) => void;
	barShown: boolean;
	onBarShown: (shown: boolean) => void;
}

/**
 * Every tool by its name, which arms it, with a star that makes it a favorite without arming it, and
 * the switch of the favorites bar on top (odd/tasks/chart-customization.md S3).
 */
function ToolList({ starred, onStar, barShown, onBarShown, onPick }: Favorites & { onPick: (kind: ToolKind) => void }) {
	return (
		<>
			<label className="flex min-h-11 cursor-pointer items-center justify-between gap-2 border-b border-line px-2 pb-1 text-[14px] text-ink">
				Barra de favoritos
				<input type="checkbox" role="switch" checked={barShown} onChange={(e) => onBarShown(e.target.checked)} className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]" />
			</label>
			{GROUPS.map((group) => (
				<section key={group.name} aria-label={group.name}>
					<h3 className="px-2 pb-1 pt-2 text-[12px] font-medium text-ink-3">{group.name}</h3>
					{group.tools.map((t) => {
						const on = !!starred[t.kind];
						return (
							<div key={t.kind} className="flex items-center">
								<button type="button" className={cn(listButton, "h-9 min-w-0 flex-1 max-[819px]:h-11")} onClick={() => onPick(t.kind)}>
									<t.icon className="h-[18px] w-[18px] shrink-0 text-ink-2" strokeWidth={1.75} aria-hidden />
									{t.label}
								</button>
								<button
									type="button"
									aria-label={on ? `Sacar ${t.label} de favoritos` : `Agregar ${t.label} a favoritos`}
									aria-pressed={on}
									onClick={() => onStar(t.kind, !on)}
									className={cn(starButton, on ? "text-accent" : "text-ink-3 hover:text-ink")}
								>
									<Star className={cn("h-[18px] w-[18px]", on && "fill-current")} strokeWidth={1.75} aria-hidden />
								</button>
							</div>
						);
					})}
				</section>
			))}
		</>
	);
}

// The tool each rail group shows, the last one chosen from it: per device, like the favorites bar's spot.
const LAST_TOOLS_KEY = "warren:chart-draw-groups";
const LAST_TOOLS_EVENT = "warren-draw-groups";
// No storage (private mode, blocked site data): this visit only.
let lastToolsSession: string | null = null;

function readLastTools() {
	if (lastToolsSession !== null) return lastToolsSession;
	try {
		return window.localStorage.getItem(LAST_TOOLS_KEY) ?? "";
	} catch {
		return "";
	}
}

function parseLastTools(raw: string): Record<string, unknown> {
	try {
		return JSON.parse(raw) ?? {};
	} catch {
		// Nothing saved, or a broken copy: every group shows its first tool.
		return {};
	}
}

function saveLastTool(group: string, kind: string) {
	const next = JSON.stringify({ ...parseLastTools(readLastTools()), [group]: kind });
	try {
		window.localStorage.setItem(LAST_TOOLS_KEY, next);
		lastToolsSession = null;
	} catch {
		lastToolsSession = next;
	}
	window.dispatchEvent(new Event(LAST_TOOLS_EVENT));
}

function subscribeLastTools(onChange: () => void) {
	window.addEventListener(LAST_TOOLS_EVENT, onChange);
	return () => window.removeEventListener(LAST_TOOLS_EVENT, onChange);
}

const menuItem =
	"flex min-h-8 cursor-pointer items-center rounded px-2 text-[13px] text-ink outline-none focus:bg-hover focus:text-ink data-[highlighted]:bg-hover";

/**
 * A rail group: its button shows the tool last chosen from it, with TradingView's corner mark, and opens
 * to its right the group's tools by name, each with its star (odd/tasks/chart-pro-redesign.md S6). The menu
 * is portaled: the rail scrolls and would clip it, and so it paints over the chart's pane separators.
 */
function GroupMenu({
	group,
	shown,
	active,
	starred,
	onStar,
	onPick,
}: Pick<Favorites, "starred" | "onStar"> & {
	group: Group;
	shown: Tool;
	active: boolean;
	onPick: (kind: ToolKind) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger aria-label={group.name} title={`${group.name}: ${shown.label}`} aria-pressed={active} className={cn(toolClass, "relative", active && activeClass)}>
				<shown.icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
				<span className="absolute bottom-1 right-1 border-[3px] border-transparent border-b-ink-3 border-r-ink-3" aria-hidden />
			</DropdownMenuTrigger>
			<DropdownMenuContent side="right" align="start" aria-label={group.name} className="w-64 max-w-[calc(100vw-32px)] rounded-lg border border-line bg-surface p-1 text-ink shadow-pop ring-0">
				<p className="px-2 pb-1 pt-2 text-[12px] font-medium text-ink-3" aria-hidden>
					{group.name}
				</p>
				{group.tools.map((t) => {
					const on = !!starred[t.kind];
					return (
						<div key={t.kind} className="flex items-center">
							<DropdownMenuItem onClick={() => onPick(t.kind)} className={cn(menuItem, "min-w-0 flex-1 gap-2")}>
								<t.icon className="size-[18px] text-ink-2" strokeWidth={1.75} aria-hidden />
								{t.label}
							</DropdownMenuItem>
							<MenuPrimitive.CheckboxItem
								checked={on}
								onCheckedChange={(checked) => onStar(t.kind, checked)}
								aria-label={`${t.label} en favoritos`}
								className={cn(starButton, "cursor-pointer outline-none data-[highlighted]:bg-hover", on ? "text-accent" : "text-ink-3 hover:text-ink")}
							>
								<Star className={cn("size-[18px]", on && "fill-current")} strokeWidth={1.75} aria-hidden />
							</MenuPrimitive.CheckboxItem>
						</div>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Below 820px the rail does not fit and its icons have no names (a phone shows no tooltip): one
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
	favorites,
	alertMenu,
}: {
	manager: DrawingManager | null;
	tool: DrawingKind | null;
	magnet: boolean;
	visible: boolean;
	alertMode: boolean;
	arm: (kind: DrawingKind | null) => void;
	onAlertMode: (on: boolean) => void;
	onMagnet: () => void;
	favorites: Favorites;
	alertMenu: AlertMenuProps | null;
}) {
	const [open, setOpen] = useState(false);
	const armed = tool ? TOOLS.find((t) => t.kind === tool) : undefined;
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
							<ToolList
								{...favorites}
								onPick={(kind) => {
									setOpen(false);
									arm(kind);
								}}
							/>
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
					{alertMenu && (
						<AlertMenu {...alertMenu} side="top" triggerClassName={barButton}>
							<Bell className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
							Alerta
						</AlertMenu>
					)}
				</>
			)}
		</div>
	);
}

type AlertMenuProps = Omit<React.ComponentProps<typeof AlertMenu>, "side" | "triggerClassName" | "triggerLabel" | "children">;

const Divider = () => <span className="h-px w-6 shrink-0 bg-line max-[819px]:h-6 max-[819px]:w-px" aria-hidden />;

// The strip's Más: its menu, the favorites list or the question of Borrar todos.
type More = "menu" | "favorites" | "clear";
// Swapping the menu for the list unmounts the focused item: the list's first control takes the focus.
const focusFirst = (el: HTMLElement | null) => el?.querySelector<HTMLElement>("input, button")?.focus();

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
	chartArea = null,
	symbol = "",
	alerts = [],
	onNewAlert = () => {},
	alertsOff = false,
	onOpenAlert = () => {},
}: {
	manager: DrawingManager | null;
	alertMode: boolean;
	onAlertMode: (on: boolean) => void;
	phoneBar?: HTMLElement | null;
	chartArea?: HTMLElement | null;
	/** The chart's ticker and its alerts, for the Alerta menu (odd/tasks/chart-customization.md S6). */
	symbol?: string;
	alerts?: readonly ChartAlert[];
	onNewAlert?: () => void;
	/** No alerts to offer: the chart is drawn in another currency than its alerts. */
	alertsOff?: boolean;
	onOpenAlert?: (id: string) => void;
}) {
	const [tool, setTool] = useState<DrawingKind | null>(null);
	const [magnet, setMagnet] = useState(false);
	const [visible, setVisible] = useState(true);
	const [more, setMore] = useState<More | null>(null);
	const { preferences, setFavorite } = useChartPreferences();
	// Per device, like the bar's spot (screens differ); the stars are the account's.
	const [barShown, setBarShown] = useState(() => readBar().shown);
	const favorites: Favorites = {
		starred: preferences.favorites,
		onStar: setFavorite,
		barShown,
		onBarShown: (shown) => {
			setBarShown(shown);
			saveBar({ shown });
		},
	};
	const starred = TOOLS.filter((t) => preferences.favorites[t.kind]);
	const lastTools = parseLastTools(useSyncExternalStore(subscribeLastTools, readLastTools, () => ""));

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
		// Wherever it was chosen (rail, favorites bar, a list), its group shows it next.
		const group = GROUPS.find((g) => g.tools.some((t) => t.kind === kind));
		if (group && kind) saveLastTool(group.name, kind);
	};

	// Alerts watch a ticker's price; Mi cartera has none.
	const alertMenu: AlertMenuProps | null = symbol === PORTFOLIO_SERIES || alertsOff ? null : {
		symbol,
		alerts,
		armed: alertMode,
		onQuick: () => {
			manager?.setTool(null);
			onAlertMode(true);
		},
		onCancel: () => onAlertMode(false),
		onNew: () => {
			arm(null);
			onNewAlert();
		},
		onOpen: (id) => {
			arm(null);
			onOpenAlert(id);
		},
	};

	const toggleMagnet = () => {
		manager?.setMagnet(magnet ? "off" : "weak");
		setMagnet(!magnet);
	};

	return (
		<>
		{phoneBar && createPortal(<PhoneTools manager={manager} tool={tool} magnet={magnet} visible={visible} alertMode={alertMode} arm={arm} onAlertMode={onAlertMode} onMagnet={toggleMagnet} favorites={favorites} alertMenu={alertMenu} />, phoneBar)}
		{chartArea && barShown && starred.length > 0 && createPortal(
			<FavoritesBar area={chartArea}>
				{starred.map((t) => (
					<ToolButton key={t.kind} label={t.label} icon={t.icon} active={tool === t.kind} onClick={() => arm(tool === t.kind ? null : t.kind)} />
				))}
			</FavoritesBar>,
			chartArea,
		)}
		<div
			role="toolbar"
			aria-label="Herramientas de dibujo"
			aria-orientation="vertical"
			className="flex shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-line bg-surface px-1 py-2 max-[819px]:hidden"
		>
			<ToolButton label="Cursor" icon={MousePointer2} active={tool === null && !alertMode} onClick={() => arm(null)} />
			{GROUPS.map((group) => (
				<GroupMenu
					key={group.name}
					group={group}
					shown={group.tools.find((t) => t.kind === lastTools[group.name]) ?? group.tools[0]}
					active={group.tools.some((t) => t.kind === tool)}
					starred={favorites.starred}
					onStar={favorites.onStar}
					onPick={arm}
				/>
			))}
			<Divider />
			{alertMenu && (
				<>
					<AlertMenu
						{...alertMenu}
						side="right"
						triggerLabel="Alertas"
						triggerClassName={cn(toolClass, alertMode && activeClass)}
					>
						<Bell className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
					</AlertMenu>
					<Divider />
				</>
			)}
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
			{/* Elegir favoritos and Borrar todos, used once in a while, share one button: with a button each the strip
			    is taller than a 1280×800 window gives it (odd/tasks/chart-customization.md S8). */}
			<Popover open={more !== null} onOpenChange={(open) => setMore(open ? "menu" : null)}>
				<PopoverTrigger title="Más" aria-label="Más" className={toolClass}>
					<MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
				</PopoverTrigger>
				{more === "favorites" ? (
					<PopoverContent side="right" aria-label="Elegir favoritos" className="max-h-[min(80vh,40rem)] w-[min(18rem,calc(100vw-32px))] overflow-y-auto p-2">
						<div ref={focusFirst}>
							<ToolList
								{...favorites}
								onPick={(kind) => {
									setMore(null);
									arm(kind);
								}}
							/>
						</div>
					</PopoverContent>
				) : more === "clear" ? (
					// InlineConfirm's question would widen the 40px vertical strip and shift the chart: same two steps in a popover.
					<PopoverContent side="right" className="flex w-[min(16rem,calc(100vw-32px))] flex-col gap-2 p-3">
						<p className="text-[13px] font-medium text-danger">¿Borrar todos los dibujos de este activo?</p>
						<div className="flex flex-wrap justify-end gap-2">
							<button
								type="button"
								className={cn(buttonVariants({ variant: "destructive", size: "sm" }), "max-[819px]:h-11")}
								onClick={() => {
									setMore(null);
									manager?.clear();
								}}
							>
								Sí, borrar
							</button>
							<button type="button" autoFocus className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-[819px]:h-11")} onClick={() => setMore(null)}>
								Cancelar
							</button>
						</div>
					</PopoverContent>
				) : (
					<PopoverContent side="right" aria-label="Más" className="flex w-56 flex-col p-1">
						<button type="button" className={listButton} onClick={() => setMore("favorites")}>
							<Star className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.75} aria-hidden />
							Elegir favoritos
						</button>
						<button
							type="button"
							disabled={!manager || manager.drawings().length === 0}
							className={cn(listButton, "text-danger disabled:pointer-events-none disabled:opacity-50")}
							onClick={() => setMore("clear")}
						>
							<Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
							Borrar todos los dibujos
						</button>
					</PopoverContent>
				)}
			</Popover>
		</div>
		</>
	);
}
