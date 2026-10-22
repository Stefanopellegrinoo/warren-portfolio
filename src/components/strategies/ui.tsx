'use client'

import { X } from 'lucide-react'
import { DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// Shared pieces of the strategies screens, on the new tokens.
// The ui primitives (Input, Select) still carry undefined shadcn tokens, so these screens use native controls.

export const page = 'mx-auto w-full max-w-[1240px] px-10 pb-16 pt-8 max-[819px]:px-4 max-[819px]:pb-24 max-[819px]:pt-5'
export const pageTitle = 'font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl'
export const field = 'min-h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink tabular-nums placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-accent focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_28%,transparent)] max-[819px]:min-h-11'
export const label = 'text-[13px] font-medium text-ink'
export const primaryButton = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-on hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 max-[819px]:min-h-11'
export const secondaryButton = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line-strong px-4 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60 max-[819px]:min-h-11'
export const ghostButton = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60 max-[819px]:min-h-11'
export const iconButton = 'grid h-8 w-8 flex-none place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60 max-[819px]:h-11 max-[819px]:w-11'
export const textLink = 'inline-flex min-h-6 items-center gap-1 text-[13px] font-medium text-accent-ink hover:underline hover:underline-offset-2 max-[819px]:min-h-11'

export function ErrorNotice({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
      {children}
      {onRetry && <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2 max-[819px]:min-h-11">Reintentar</button>}
    </div>
  )
}

export function SkeletonRows({ label: name, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={name} className="grid gap-3 pt-3">
      {Array.from({ length: rows }, (_, i) => <span key={i} className="block h-14 animate-pulse rounded bg-surface-2" />)}
    </div>
  )
}

/** Radio group drawn as a segmented control, as in the Resumen period selector. */
export function Segmented<T extends string>({ name, legend, options, value, onChange }: {
  name: string
  legend: string
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <fieldset className="inline-flex max-w-full flex-wrap gap-0.5 rounded-md border border-line bg-surface-2 p-0.5">
      <legend className="sr-only">{legend}</legend>
      {options.map(o => (
        <label
          key={o.value}
          className="relative inline-flex min-h-8 cursor-pointer items-center rounded px-3 text-[13px] text-ink-2 has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-[0_0_0_1px_var(--line)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring max-[819px]:min-h-11 max-[819px]:px-2.5"
        >
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="absolute inset-0 m-0 cursor-pointer opacity-0" />
          {o.label}
        </label>
      ))}
    </fieldset>
  )
}

/** Underlined tab strip. Each tab is a button (in-page state) or rendered by the caller as a link. */
export const tabClass = (active: boolean) => cn(
  '-mb-px inline-flex min-h-10 items-center border-b-2 px-1 text-sm font-medium max-[819px]:min-h-11',
  active ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink',
)

/** Dialog shell on the new tokens with a Spanish close button and a phone-safe width. */
export function StrategyDialog({ title, width = 520, children }: { title: string; width?: number; children: React.ReactNode }) {
  return (
    <DialogContent
      showCloseButton={false}
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      className="max-h-[calc(100dvh-32px)] max-w-none gap-0 overflow-y-auto rounded-lg border border-line bg-surface p-0 text-ink shadow-pop ring-0 sm:max-w-none"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface py-3 pl-5 pr-3">
        <DialogTitle className="text-base font-semibold leading-tight">{title}</DialogTitle>
        <DialogClose aria-label="Cerrar" className={iconButton}>
          <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </DialogClose>
      </div>
      {children}
    </DialogContent>
  )
}

/** Footer with the actions of a dialog form. */
export function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 border-t border-line px-5 py-4 max-[819px]:flex-col-reverse max-[819px]:items-stretch">{children}</div>
}
