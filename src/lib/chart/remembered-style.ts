import {
	factoryStyleFor,
	setDefaultStyleOverride,
	type Drawing,
	type DrawingKind,
	type DrawingManager,
	type DrawingStyle,
} from "lightweight-charts-drawing";
import { getPreferences, setToolStyle, subscribe } from "./preferences";
import { TOOL_KINDS, type ToolKind } from "./preferences-schema";

/**
 * The style last chosen per tool (odd/tasks/chart-customization.md S2, user: "Salga igual"), kept in
 * the account by the chart preferences (toolStyles). The library builds every new drawing's style,
 * and the preview of the one being placed, as its factory style plus the override set here, so a new
 * drawing comes out with it at once. Saved drawings never go through it (importJSON keeps their own).
 */

const isTool = (kind: string): kind is ToolKind => (TOOL_KINDS as readonly string[]).includes(kind);

// What belongs to one drawing, not to its tool: its on-line text, a position's stop and target.
const OWN_FIELDS = ["text", "stopLevel", "profitLevel"] as const;

/** Turns the remembered styles on for new drawings; returns the undo (the library's factory styles). */
export function applyRememberedStyles(): () => void {
	const off = subscribe(() => {}); // loads the account's copy
	setDefaultStyleOverride((kind) => (isTool(kind) ? (getPreferences().toolStyles[kind] as DrawingStyle | undefined) : undefined));
	return () => {
		off();
		setDefaultStyleOverride(() => undefined);
	};
}

/** What a tool remembers from a drawing's style: what differs from its factory style. */
function remember(kind: DrawingKind, style: DrawingStyle) {
	if (!isTool(kind)) return;
	const factory = factoryStyleFor(kind) as Record<string, unknown>;
	const diff = Object.fromEntries(
		Object.entries(style).filter(
			([key, value]) => value !== undefined && !(OWN_FIELDS as readonly string[]).includes(key) && JSON.stringify(value) !== JSON.stringify(factory[key]),
		),
	);
	setToolStyle(kind, Object.keys(diff).length > 0 ? diff : null);
}

/** Restyles drawings; each one's new style becomes the style of its tool. */
export function restyle(manager: DrawingManager, drawings: readonly Drawing[], patch: (d: Drawing) => Partial<DrawingStyle>) {
	for (const d of drawings) {
		// The drawing as it is now: a slider sends changes faster than the bar re-renders.
		const now = manager.get(d.id) ?? d;
		const style = { ...now.style, ...patch(now) };
		manager.update({ ...now, style });
		remember(now.kind, style);
	}
}

/** "Volver al de fábrica": the drawing and its tool go back to the library's style; the drawing keeps what is its own. */
export function resetToFactory(manager: DrawingManager, d: Drawing) {
	const own = Object.fromEntries(OWN_FIELDS.filter((key) => d.style[key] !== undefined).map((key) => [key, d.style[key]]));
	manager.update({ ...d, style: { ...factoryStyleFor(d.kind), ...own } });
	if (isTool(d.kind)) setToolStyle(d.kind, null);
}
