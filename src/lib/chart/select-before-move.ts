import type { DrawingManager } from "lightweight-charts-drawing";

/** How far a finger may wander and still tap: the drawing layer's touch drag threshold. */
const TAP_SLOP_PX = 8;

/** Calls `tap` when the press lifts without having moved `slop` px; a drag, a cancel or a second
 *  finger (a pinch) drops it. */
export function onTap(down: PointerEvent, slop: number, tap: () => void) {
	const done = new AbortController();
	const mine = (e: PointerEvent) => e.pointerId === down.pointerId;
	const opts = { signal: done.signal };
	window.addEventListener("pointermove", (e) => {
		if (mine(e) && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) >= slop) done.abort();
	}, opts);
	window.addEventListener("pointerup", (e) => {
		if (!mine(e)) return;
		done.abort();
		tap();
	}, opts);
	window.addEventListener("pointercancel", (e) => mine(e) && done.abort(), opts);
	// Capture: this press has already passed the window on its way down.
	window.addEventListener("pointerdown", () => done.abort(), { ...opts, capture: true });
}

/**
 * With a finger, a drawing is selected before it moves (odd/tasks/chart-customization.md S1).
 * The drawing layer takes any press on a drawing: it selects it, holds the chart still and drags
 * a point of it right away, so a finger panning across the chart grabbed whatever it crossed.
 * Here a finger's press on a drawing that is not selected (or is locked), or on an empty part of
 * the chart, never reaches the layer: the chart pans, and a tap selects or deselects. A press
 * on the selected drawing, the mouse and a finger with a tool armed reach it untouched.
 *
 * Add it before the DrawingManager is created: listeners on one element run in the order they
 * were added, so the press reaches this one before the layer's.
 */
export function selectBeforeMove(el: HTMLElement, manager: () => DrawingManager | null): () => void {
	// The drawing under the finger, as the layer finds it for a hover (with finger-sized hit
	// areas, scripts/patch-drawing-lib.mjs), and the hover forgotten again: a touch screen has none.
	const drawingAt = (m: DrawingManager, e: PointerEvent) => {
		const probe = (type: string) => el.dispatchEvent(new PointerEvent(type, { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: "touch" }));
		probe("pointermove");
		const id = m.hoveredId();
		probe("pointerleave");
		return id === null ? undefined : m.get(id);
	};

	const onDown = (e: PointerEvent) => {
		const m = manager();
		if (!m || e.pointerType !== "touch" || m.tool() !== null) return;
		const drawing = drawingAt(m, e);
		const selected = m.selection();
		if (drawing ? selected.includes(drawing.id) && !drawing.locked : selected.length === 0) return;
		// Immediate: the layer listens on this same element.
		e.stopImmediatePropagation();
		onTap(e, TAP_SLOP_PX, () => m.select(drawing ? [drawing.id] : []));
	};
	el.addEventListener("pointerdown", onDown, true);
	return () => el.removeEventListener("pointerdown", onDown, true);
}
