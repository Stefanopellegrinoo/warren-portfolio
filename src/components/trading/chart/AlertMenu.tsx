"use client";

import { useState } from "react";
import { MousePointerClick, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { conditionText, type ChartAlert } from "@/lib/chart/alerts";

const itemClass =
	"flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-[14px] text-ink hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring min-[820px]:min-h-9";
const STATE = { active: null, triggered: "Disparada", unavailable: "No se puede revisar" };

/**
 * What the Alerta button opens (odd/tasks/chart-customization.md S6): today's quick alert (a tap on the chart at
 * the price), a new alert in the sheet, and this ticker's alerts, each opening its sheet. An alert with no line on
 * the chart ("price crosses EMA 50") is seen and edited here. While the quick alert waits for its tap, the button
 * cancels it instead.
 */
export function AlertMenu({
	symbol,
	alerts,
	armed,
	onQuick,
	onCancel,
	onNew,
	onOpen,
	side,
	triggerClassName,
	triggerLabel,
	children,
}: {
	symbol: string;
	alerts: readonly ChartAlert[];
	armed: boolean;
	onQuick: () => void;
	onCancel: () => void;
	onNew: () => void;
	onOpen: (id: string) => void;
	side: "top" | "right";
	triggerClassName: string;
	triggerLabel?: string;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const pick = (action: () => void) => () => {
		setOpen(false);
		action();
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				if (next && armed) onCancel();
				else setOpen(next);
			}}
		>
			<PopoverTrigger aria-label={triggerLabel} title={triggerLabel} aria-pressed={side === "right" ? armed : undefined} className={triggerClassName}>
				{children}
			</PopoverTrigger>
			<PopoverContent side={side} aria-label="Alertas" className="max-h-[min(70vh,32rem)] w-[min(20rem,calc(100vw-16px))] overflow-y-auto p-2">
				<button type="button" className={itemClass} onClick={pick(onQuick)}>
					<MousePointerClick className="h-[18px] w-[18px] shrink-0 text-ink-2" strokeWidth={1.75} aria-hidden />
					Tocar el precio en el gráfico
				</button>
				<button type="button" className={itemClass} onClick={pick(onNew)}>
					<Plus className="h-[18px] w-[18px] shrink-0 text-ink-2" strokeWidth={1.75} aria-hidden />
					Nueva alerta…
				</button>
				<section aria-label={`Alertas de ${symbol}`} className="mt-1 border-t border-line pt-1">
					<h3 className="px-2 pb-1 pt-1 text-[12px] font-medium text-ink-3">Alertas de {symbol}</h3>
					{alerts.length === 0 && <p className="px-2 py-2 text-[13px] text-ink-3">No hay alertas en {symbol}.</p>}
					{alerts.map((a) => (
						<button key={a.id} type="button" data-alert-item className={cn(itemClass, "items-start py-2")} onClick={pick(() => onOpen(a.id))}>
							<span data-alert-color className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color ?? "var(--accent)" }} aria-hidden />
							<span className="flex min-w-0 flex-col">
								<span className={cn("tabular-nums", a.status !== "active" && "text-ink-2")}>{conditionText(a)}</span>
								{STATE[a.status] && <span className={cn("text-[12px]", a.status === "unavailable" ? "text-danger" : "text-ink-3")}>{STATE[a.status]}</span>}
							</span>
						</button>
					))}
				</section>
			</PopoverContent>
		</Popover>
	);
}
