"use client";

import { X } from "lucide-react";
import { DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn, formatNumber } from "@/lib/utils";

// Shared pieces of the trading screen.
// The shared ui primitives carry undefined shadcn tokens, so every trading dialog
// goes through this shell: new tokens, a Spanish close button, phone-width safe.
export function TradingDialog({ title, width = 400, className, children }: {
  title: React.ReactNode;
  width?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <DialogContent
      showCloseButton={false}
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      className={cn("max-w-none gap-0 rounded-lg border border-line bg-surface p-0 text-ink shadow-pop ring-0 sm:max-w-none", className)}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line py-2 pl-4 pr-2">
        <DialogTitle className="text-base font-semibold leading-tight">{title}</DialogTitle>
        <DialogClose aria-label="Cerrar" className={iconButton}>
          <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </DialogClose>
      </div>
      {children}
    </DialogContent>
  );
}

export const field =
  "h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink tabular-nums outline-none placeholder:text-ink-3 focus:border-ring max-[819px]:h-11";
export const primaryButton =
  "inline-flex min-h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-on hover:bg-primary-hover disabled:opacity-60 max-[819px]:min-h-11";
export const ghostButton =
  "inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink max-[819px]:min-h-11";
export const dangerButton =
  "inline-flex min-h-9 items-center justify-center rounded-md bg-danger px-4 text-sm font-medium text-surface hover:opacity-90 max-[819px]:min-h-11";
// A button of the phone's bottom bar: the icon over its name, a fifth of the width.
export const barButton =
  "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded px-0.5 text-[11px] leading-none text-ink-2 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

export const iconButton =
  "grid h-8 w-8 flex-none place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[819px]:h-11 max-[819px]:w-11";

/** Same price format as the chart's legend: es-AR, four decimals under 1. */
export const priceText = (p: number) => formatNumber(p, { decimals: Math.abs(p) < 1 ? 4 : 2 });
