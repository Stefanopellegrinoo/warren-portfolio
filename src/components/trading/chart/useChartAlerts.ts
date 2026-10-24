"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { alertName, operatorFor, type ChartAlert } from "@/lib/chart/alerts";
import { requestErrorMessage } from "@/lib/request-errors";

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

const toAlert = (r: Record<string, unknown>): ChartAlert => ({
	id: String(r.id),
	ticker: String(r.ticker),
	operator: r.operator as ChartAlert["operator"],
	value: Number(r.value),
	name: String(r.name),
	status: r.status === "triggered" ? "triggered" : "active",
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

	const move = useCallback(
		(id: string, value: number) => {
			if (lastPrice === null) return Promise.resolve(false);
			const operator = operatorFor(value, lastPrice);
			return patch(id, { value, operator, name: alertName(symbol, operator, value) }, "No se pudo mover la alerta");
		},
		[patch, symbol, lastPrice],
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

	return { alerts, create, move, rearm, remove };
}
