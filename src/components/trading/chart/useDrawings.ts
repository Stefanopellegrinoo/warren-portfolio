"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { DrawingManager } from "lightweight-charts-drawing";
import { fromLegacyDrawings, type LegacyDrawing } from "@/lib/chart/legacy-drawings";

const SAVE_DELAY_MS = 600;
// Browsers cap keepalive requests at 64 KB in flight, all together: only the save on the
// way out uses it, and a bigger set (long brush strokes) goes as a plain request.
const KEEPALIVE_MAX_BYTES = 60_000;

async function loadDrawings(symbol: string): Promise<{ json: string; fromLegacy: boolean }> {
	const res = await fetch(`/api/chart-drawings?ticker=${encodeURIComponent(symbol)}`);
	if (!res.ok) throw new Error(`Error ${res.status}`);
	const { drawings, legacy } = (await res.json()) as { drawings: unknown[] | null; legacy?: LegacyDrawing[] };
	if (drawings) return { json: JSON.stringify(drawings), fromLegacy: false };

	// Never saved in the new format: the old per-row drawings came in the same response.
	const rows = legacy ?? [];
	return { json: JSON.stringify(fromLegacyDrawings(rows)), fromLegacy: rows.length > 0 };
}

/**
 * Loads a ticker's drawings into the manager and saves every change, debounced.
 * Nothing is saved until the load succeeded, so a failed load can never
 * overwrite the stored drawings with an empty list.
 */
export function useDrawings(manager: DrawingManager | null, symbol: string) {
	const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

	useEffect(() => {
		if (!manager) return;
		let loaded = false;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		setStatus("loading");
		manager.clear();

		const save = async (leaving = false) => {
			const body = JSON.stringify({ ticker: symbol, drawings: JSON.parse(manager.exportJSON()) });
			try {
				const res = await fetch("/api/chart-drawings", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body,
					// The save outlives the page when the app is closed or sent to the background.
					keepalive: leaving && new Blob([body]).size < KEEPALIVE_MAX_BYTES,
				});
				if (!res.ok) throw new Error(`Error ${res.status}`);
			} catch {
				toast.error("No se pudieron guardar los dibujos", { description: `${symbol}: se reintenta con el próximo cambio.` });
			}
		};
		const schedule = () => {
			if (!loaded) return;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				save();
			}, SAVE_DELAY_MS);
		};
		const off = manager.on("change", schedule);
		const flush = () => {
			if (!timer) return;
			clearTimeout(timer);
			timer = null;
			save(true);
		};
		// A PWA sent to the background may never come back: save now, not 600ms later.
		const onVisibility = () => {
			if (document.visibilityState === "hidden") flush();
		};
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("pagehide", flush);

		loadDrawings(symbol)
			.then(({ json, fromLegacy }) => {
				if (cancelled) return;
				manager.importJSON(json);
				loaded = true;
				setStatus("ready");
				if (fromLegacy) save();
			})
			.catch(() => {
				if (cancelled) return;
				setStatus("error");
				toast.error("No se pudieron cargar los dibujos", { description: `${symbol}: los cambios no se guardan hasta recargar.` });
			});

		return () => {
			cancelled = true;
			off();
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("pagehide", flush);
			// Flush a pending save for this ticker before the next one loads.
			flush();
		};
	}, [manager, symbol]);

	return status;
}
