import type { DrawingKind, DrawingManager } from "lightweight-charts-drawing";

const DRAG_PX = 8;
// Freehand tools follow the finger on their own: a press starts the stroke, the lift ends it.
const FREEHAND: (DrawingKind | null)[] = ["brush", "highlighter"];

/**
 * With a finger, a drawing tool also draws by dragging (odd/tasks/grafico-celular.md S2).
 * The library places a point on each press and only previews the next one on hover, which a
 * finger never sends. So while a finger drags with a placement in progress, its moves are
 * passed to the library as hover moves (the drawing follows the finger) and the lift as the
 * press of the next point. Taps and the mouse reach the library untouched.
 */
export function touchDrawing(manager: DrawingManager, el: HTMLElement): () => void {
	const ours = new WeakSet<Event>();
	let drag: { id: number; x: number; y: number; moved: boolean } | null = null;

	const send = (target: EventTarget, type: string, e: PointerEvent, buttons: number) => {
		const synthetic = new PointerEvent(type, {
			clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: "touch",
			button: 0, buttons, bubbles: true, cancelable: true,
		});
		ours.add(synthetic);
		target.dispatchEvent(synthetic);
	};
	const placing = () => {
		const tool = manager.tool();
		return tool !== null && !FREEHAND.includes(tool);
	};

	// Capture, after the library's own capture listener: the first point is already placed.
	const onDown = (e: PointerEvent) => {
		if (ours.has(e) || e.pointerType !== "touch") return;
		drag = placing() ? { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false } : null;
	};
	const onMove = (e: PointerEvent) => {
		if (ours.has(e) || !drag || e.pointerId !== drag.id) return;
		if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_PX) return;
		drag.moved = true;
		send(el, "pointermove", e, 0);
	};
	const onUp = (e: PointerEvent) => {
		if (ours.has(e) || !drag || e.pointerId !== drag.id) return;
		const { moved } = drag;
		drag = null;
		if (!moved || !placing()) return;
		send(el, "pointerdown", e, 1);
		// The library holds the chart still until the press it saw is released.
		send(window, "pointerup", e, 0);
	};
	const onCancel = () => { drag = null; };

	el.addEventListener("pointerdown", onDown, true);
	window.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", onUp);
	window.addEventListener("pointercancel", onCancel);
	return () => {
		el.removeEventListener("pointerdown", onDown, true);
		window.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", onUp);
		window.removeEventListener("pointercancel", onCancel);
	};
}
