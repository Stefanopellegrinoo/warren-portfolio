"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { alertName, conditionName, operatorFor, type ChartAlert } from "@/lib/chart/alerts";
import type { AlertCondition } from "@/lib/chart/alert-condition";
import { requestErrorMessage } from "@/lib/request-errors";

/** What the alert sheet saves (odd/tasks/chart-customization.md S6): a whole condition and a color. */
export type AlertDraft = AlertCondition & { color: string | null };

async function send(url: string, method: string, body?: unknown) {
	const res = await fetch(url, {
		method,
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = await res.json().catch(() => null);
	if (!res.ok) throw new Error(json?.error ?? "");
	return json;
}

// The server's message, or a Spanish one when it sent none or the request never arrived.
const failed = (title: string, e: unknown) => toast.error(title, { description: requestErrorMessage(e, "Probá de nuevo.") });

const STATUSES = ["active", "triggered", "unavailable"] as const;

// A row from before migration 052 (or an old server) has no condition: the price against its value.
const toAlert = (r: Record<string, unknown>): ChartAlert => ({
	id: String(r.id),
	ticker: String(r.ticker),
	operator: r.operator as ChartAlert["operator"],
	value: r.value === null || r.value === undefined ? null : Number(r.value),
	name: String(r.name),
	status: STATUSES.find((s) => s === r.status) ?? "active",
	source: typeof r.source === "string" ? r.source : "price",
	target: typeof r.target === "string" ? r.target : "value",
	timeframe: (r.timeframe as ChartAlert["timeframe"]) ?? null,
	periods: (r.periods as ChartAlert["periods"]) ?? null,
	color: typeof r.color === "string" ? r.color : null,
});

/**
 * The current ticker's price alerts and the actions the chart offers on them.
 * Every action updates the list only after the server confirmed it, and says
 * so when it failed.
 */
export function useChartAlerts(symbol: string, lastPrice: number | null) {
	const [alerts, setAlerts] = useState<ChartAlert[]>([]);

	useEffect(() => {
		let cancelled = false;
		setAlerts([]);
		send(`/api/price-alerts?ticker=${encodeURIComponent(symbol)}`, "GET")
			.then(({ alerts: rows }: { alerts: Record<string, unknown>[] }) => {
				if (!cancelled) setAlerts(rows.map(toAlert));
			})
			.catch(() => {
				if (!cancelled) toast.error("No se pudieron cargar las alertas");
			});
		return () => {
			cancelled = true;
		};
	}, [symbol]);

	const create = useCallback(
		async (value: number) => {
			if (lastPrice === null) return;
			const operator = operatorFor(value, lastPrice);
			try {
				const { alert } = await send("/api/price-alerts", "POST", {
					ticker: symbol,
					type: "price",
					operator,
					value,
					name: alertName(symbol, operator, value),
				});
				setAlerts((a) => [...a, toAlert(alert)]);
				toast.success("Alerta creada", { description: alertName(symbol, operator, value) });
			} catch (e) {
				failed("No se pudo crear la alerta", e);
			}
		},
		[symbol, lastPrice],
	);

	/** A new alert (id null) or a changed one, from the sheet: the condition goes whole. */
	const save = useCallback(
		async (id: string | null, draft: AlertDraft) => {
			const { source, operator, target, value, timeframe, periods, color } = draft;
			const body = { source, operator, target, value, timeframe, periods, color, name: conditionName(symbol, draft) };
			try {
				if (id) {
					const { alert } = await send(`/api/price-alerts/${id}`, "PATCH", body);
					setAlerts((a) => a.map((x) => (x.id === id ? toAlert(alert) : x)));
					toast.success("Alerta guardada");
				} else {
					const { alert } = await send("/api/price-alerts", "POST", { ticker: symbol, type: "price", ...body });
					setAlerts((a) => [...a, toAlert(alert)]);
					toast.success("Alerta creada", { description: body.name });
				}
				return true;
			} catch (e) {
				failed(id ? "No se pudo guardar la alerta" : "No se pudo crear la alerta", e);
				return false;
			}
		},
		[symbol],
	);

	const patch = useCallback(async (id: string, changes: Partial<Pick<ChartAlert, "value" | "operator" | "name" | "status">>, failMsg: string) => {
		try {
			await send(`/api/price-alerts/${id}`, "PATCH", changes);
			setAlerts((a) => a.map((x) => (x.id === id ? { ...x, ...changes } : x)));
			return true;
		} catch (e) {
			failed(failMsg, e);
			return false;
		}
	}, []);

	// A dragged line watches up or down by where it lands, as always; one set to either way stays either way.
	const move = useCallback(
		(id: string, value: number) => {
			const alert = alerts.find((a) => a.id === id);
			if (lastPrice === null || !alert) return Promise.resolve(false);
			const operator = alert.operator === "crosses" ? "crosses" : operatorFor(value, lastPrice);
			return patch(id, { value, operator, name: conditionName(symbol, { ...alert, operator, value }) }, "No se pudo mover la alerta");
		},
		[patch, symbol, lastPrice, alerts],
	);

	const rearm = useCallback((id: string) => patch(id, { status: "active" }, "No se pudo reactivar la alerta"), [patch]);

	const remove = useCallback(async (id: string) => {
		try {
			await send(`/api/price-alerts/${id}`, "DELETE");
			setAlerts((a) => a.filter((x) => x.id !== id));
			toast.success("Alerta eliminada");
		} catch (e) {
			failed("No se pudo eliminar la alerta", e);
		}
	}, []);

	return { alerts, create, save, move, rearm, remove };
}
