"use client";

import { X } from "lucide-react";
import { priceDecimals } from "@/lib/chart/alerts";
import { qtyText, type Trade } from "@/lib/chart/trade-markers";
import { formatNumber } from "@/lib/utils";
import { ChartSheet } from "./ChartSheet";

// Numeric, like the Historial's dates: the card fits a 320px phone.
const DAY = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const dateText = (date: string) => DAY.format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
const OPERATION = { COMPRA: "Compra", VENTA: "Venta", DIVIDENDO: "Dividendo" };
const CARD_PX = 240;
const priceText = (price: number) => formatNumber(price, { decimals: priceDecimals(price) });
const opClass = (t: Trade) => (t.operation === "VENTA" ? "text-danger" : "text-ok");

/** On a phone: a sheet from the bottom, one row per operation, readable at 320px. */
export function TradeSheet({ trades, onClose }: { trades: readonly Trade[]; onClose: () => void }) {
	return (
		<ChartSheet open onOpenChange={(open) => !open && onClose()} title="Operaciones">
			<ul className="divide-y divide-line tabular-nums">
				{trades.map((t) => (
					<li key={t.id} className="flex items-center justify-between gap-4 py-3">
						<div className="flex flex-col">
							<span className={`font-medium ${opClass(t)}`}>{OPERATION[t.operation]}</span>
							<span className="text-[13px] text-ink-3">{dateText(t.date)}</span>
						</div>
						<div className="grid grid-cols-[auto_auto] gap-x-3 text-right">
							<span className="text-[13px] text-ink-3">Cantidad</span>
							<span className="text-ink">{qtyText(t.quantity)}</span>
							<span className="text-[13px] text-ink-3">Precio</span>
							<span className="text-ink">{priceText(t.price)}</span>
						</div>
					</li>
				))}
			</ul>
		</ChartSheet>
	);
}

/**
 * From 820px, the operations of the bar whose arrow was clicked, next to where it was clicked: over it in the
 * lower half of the chart, under it in the upper half, always inside the chart.
 */
export function TradeCard({ trades, x, y, above, onClose }: { trades: readonly Trade[]; x: number; y: number; above: boolean; onClose: () => void }) {
	return (
		<div
			role="dialog"
			aria-label="Operaciones"
			className="absolute z-20 w-[min(15rem,calc(100%-16px))] rounded border border-line bg-surface p-2 text-[13px] shadow-[var(--shadow-pop)]"
			style={{
				left: `clamp(8px, ${x - CARD_PX / 2}px, calc(100% - ${CARD_PX + 8}px))`,
				...(above ? { bottom: `calc(100% - ${y - 12}px)` } : { top: y + 12 }),
			}}
		>
			<div className="flex items-center justify-between gap-2 pl-1">
				<span className="font-medium text-ink">Operaciones</span>
				<button
					type="button"
					aria-label="Cerrar"
					title="Cerrar"
					onClick={onClose}
					className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink max-[819px]:h-11 max-[819px]:w-11"
				>
					<X className="h-4 w-4" aria-hidden />
				</button>
			</div>
			<table className="w-full whitespace-nowrap tabular-nums">
				<thead className="text-[12px] text-ink-3">
					<tr>
						<th className="px-1 py-0.5 text-left font-normal">Fecha</th>
						<th className="px-1 py-0.5 text-left font-normal">Operación</th>
						<th className="px-1 py-0.5 text-right font-normal">Cantidad</th>
						<th className="px-1 py-0.5 text-right font-normal">Precio</th>
					</tr>
				</thead>
				<tbody>
					{trades.map((t) => (
						<tr key={t.id}>
							<td className="whitespace-nowrap px-1 py-0.5 text-ink-2">{dateText(t.date)}</td>
							<td className={`px-1 py-0.5 ${opClass(t)}`}>{OPERATION[t.operation]}</td>
							<td className="px-1 py-0.5 text-right text-ink">{qtyText(t.quantity)}</td>
							<td className="px-1 py-0.5 text-right text-ink">{priceText(t.price)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
