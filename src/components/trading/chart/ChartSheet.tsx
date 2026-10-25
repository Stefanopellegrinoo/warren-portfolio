"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { ghostButton } from "@/components/trading/ui";
import { cn } from "@/lib/utils";

// Phone: from the bottom, full width, at most 80% of the screen, clear of the home bar.
// From 820px: a centered dialog. The focus stays inside while open, Esc closes it, and the focus
// goes back to what opened it (the dialog's own behavior).
const sheetClass = cn(
	"fixed z-50 flex flex-col border border-line bg-surface text-sm text-ink shadow-[var(--shadow-pop)] outline-none",
	"max-[819px]:inset-x-0 max-[819px]:bottom-0 max-[819px]:max-h-[80dvh] max-[819px]:rounded-t-xl max-[819px]:border-x-0 max-[819px]:border-b-0 max-[819px]:pb-[env(safe-area-inset-bottom)]",
	"min-[820px]:left-1/2 min-[820px]:top-1/2 min-[820px]:max-h-[min(40rem,calc(100dvh-4rem))] min-[820px]:w-[min(26rem,calc(100vw-32px))] min-[820px]:-translate-x-1/2 min-[820px]:-translate-y-1/2 min-[820px]:rounded-lg",
);

/**
 * The chart's settings (a drawing's, an indicator's, an alert's; odd/tasks/chart-customization.md
 * S2, S5, S6): its title and Listo on top, the options in a body that scrolls, an optional footer.
 */
export function ChartSheet({
	open,
	onOpenChange,
	title,
	footer,
	action,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: React.ReactNode;
	footer?: React.ReactNode;
	/** Replaces Listo in the header, for a sheet whose changes are only kept on purpose (an alert). */
	action?: { label: string; onClick: () => void; disabled?: boolean };
	children: React.ReactNode;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				{/* Light: the drawing being changed shows through. */}
				<DialogOverlay className="bg-black/20" />
				<DialogPrimitive.Popup className={sheetClass}>
					<div className="flex shrink-0 items-center gap-3 border-b border-line py-1.5 pl-4 pr-2">
						<DialogTitle className="min-w-0 flex-1 truncate">{title}</DialogTitle>
						{action ? (
							<button type="button" onClick={action.onClick} disabled={action.disabled} className={cn(ghostButton, "font-medium text-accent-ink disabled:opacity-50")}>
								{action.label}
							</button>
						) : (
							<DialogClose className={cn(ghostButton, "font-medium text-accent-ink")}>Listo</DialogClose>
						)}
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2">{children}</div>
					{footer && <div className="shrink-0 border-t border-line px-4 py-3">{footer}</div>}
				</DialogPrimitive.Popup>
			</DialogPortal>
		</Dialog>
	);
}
