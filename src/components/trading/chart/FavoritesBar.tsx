"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { GripHorizontal } from "lucide-react";
import { clampBar, readBar, saveBar, type BarPosition } from "@/lib/chart/favorites-bar";

// Until it is moved, the bar sits at the chart's top-left, this far under the legend (OHLC and the indicators toggle).
const GAP_PX = 8;
const KEY_STEP_PX = 16;
const KEY_STEPS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Where the bar goes inside the chart: `want`, or under the legend, kept inside. */
function fit(area: HTMLElement, bar: HTMLElement, want: BarPosition | null): BarPosition {
	const legend = area.querySelector<HTMLElement>("[data-chart-legend]");
	const under = { x: GAP_PX, y: legend ? legend.offsetTop + legend.offsetHeight + GAP_PX : GAP_PX };
	return clampBar(want ?? under, { width: bar.offsetWidth, height: bar.offsetHeight }, { width: area.clientWidth, height: area.clientHeight });
}

/**
 * The favorite tools, floating over the chart in `area` (odd/tasks/chart-customization.md S3): it
 * takes no strip of the layout, and its grip drags it anywhere inside the chart. The spot is kept
 * on this device and the bar is kept inside the chart however it resizes or turns; the spot saved
 * stays as it was, so the bar goes back to it when there is room again.
 *
 * The bar is not inside the chart box, so its presses never reach the chart or its drawing layer;
 * the grip holds the pointer it took (pointer capture) and keeps the browser off it (touch-none).
 */
export function FavoritesBar({ area, children }: { area: HTMLElement; children: React.ReactNode }) {
	const barRef = useRef<HTMLDivElement>(null);
	const saved = useRef<BarPosition | null>(null);
	const drag = useRef<{ id: number; x: number; y: number; from: BarPosition; to: BarPosition } | null>(null);
	const [at, setAt] = useState<BarPosition | null>(null);

	useLayoutEffect(() => {
		const bar = barRef.current!;
		saved.current = readBar().position;
		const place = () => {
			if (!drag.current) setAt(fit(area, bar, saved.current));
		};
		place();
		// The chart resizes and turns with the screen, the bar grows with its tools, the legend opens and folds.
		const watch = new ResizeObserver(place);
		[area, bar, area.querySelector("[data-chart-legend]")].forEach((el) => el && watch.observe(el));
		return () => watch.disconnect();
	}, [area]);

	const keep = (to: BarPosition) => {
		saved.current = to;
		saveBar({ position: to });
	};
	const moveTo = (e: React.PointerEvent) => {
		const d = drag.current;
		if (!d || e.pointerId !== d.id) return;
		d.to = fit(area, barRef.current!, { x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y });
		setAt(d.to);
	};
	const drop = (e: React.PointerEvent) => {
		const d = drag.current;
		if (!d || e.pointerId !== d.id) return;
		drag.current = null;
		if (d.to !== d.from) keep(d.to);
	};

	return (
		<div
			ref={barRef}
			role="toolbar"
			aria-label="Favoritos"
			aria-orientation="vertical"
			className="absolute z-10 flex max-h-[calc(100%-8px)] flex-col items-center rounded border border-line bg-surface p-0.5 shadow-[var(--shadow-pop)]"
			style={{ left: at?.x ?? 0, top: at?.y ?? 0 }}
		>
			<button
				type="button"
				aria-label="Mover la barra de favoritos"
				title="Mover la barra de favoritos"
				className="grid h-6 w-full shrink-0 cursor-grab touch-none place-items-center rounded text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing max-[819px]:h-11"
				onPointerDown={(e) => {
					if (!at || e.button !== 0) return;
					// No text selection, and no emulated mouse press for the chart to see.
					e.preventDefault();
					e.currentTarget.setPointerCapture?.(e.pointerId);
					drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: at, to: at };
				}}
				onPointerMove={moveTo}
				onPointerUp={drop}
				onPointerCancel={drop}
				onKeyDown={(e) => {
					const step = KEY_STEPS[e.key];
					if (!step || !at) return;
					e.preventDefault();
					const to = fit(area, barRef.current!, { x: at.x + step[0] * KEY_STEP_PX, y: at.y + step[1] * KEY_STEP_PX });
					setAt(to);
					keep(to);
				}}
			>
				<GripHorizontal className="h-4 w-4" strokeWidth={1.75} aria-hidden />
			</button>
			<div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">{children}</div>
		</div>
	);
}
