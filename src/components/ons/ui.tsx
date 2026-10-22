import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

// Shared pieces of the ON pages, on the same tokens and idioms as the Resumen.

export const PAGE = 'mx-auto w-full max-w-[1240px] px-10 pb-16 pt-8 max-[819px]:px-4 max-[819px]:pb-24 max-[819px]:pt-5'

export const field =
  'min-h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 hover:border-ink-3 ' +
  'focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_28%,transparent)] focus-visible:outline-none aria-[invalid=true]:border-danger max-[819px]:min-h-11'
export const label = 'text-[13px] font-medium text-ink'
export const hint = 'text-[13px] text-ink-3'

const btn = 'inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 font-medium disabled:cursor-not-allowed disabled:opacity-60 max-[819px]:min-h-11'
export const btnPrimary = `${btn} bg-primary text-primary-on hover:bg-primary-hover`
export const btnSecondary = `${btn} border border-line-strong text-ink hover:bg-hover`
export const btnQuiet = `${btn} px-3 text-ink-2 hover:bg-hover hover:text-ink`

export const TH = 'whitespace-nowrap py-2 pr-4 text-[13px] font-medium text-ink-3 last:pr-0'
export const TD = 'whitespace-nowrap py-2.5 pr-4 last:pr-0'
export const TR = 'border-b border-line last:border-b-0 hover:bg-hover'
export const HEAD_ROW = 'border-b border-line-strong'

export type TagTone = 'ok' | 'warn' | 'info' | 'neutral' | 'danger'
export const TAG_TONES: Record<TagTone, string> = {
  ok: 'bg-ok-soft text-ok before:bg-ok-dot',
  warn: 'bg-warn-soft text-warn before:bg-warn-dot',
  info: 'bg-info-soft text-info before:bg-info-dot',
  neutral: 'bg-neutral-soft text-neutral before:bg-neutral-dot',
  danger: 'bg-danger-soft text-danger before:bg-danger-dot',
}
/** Dot plus text, never color alone (same shape as the Resumen chip). */
export const tag = (tone: TagTone) =>
  cn('inline-flex min-h-[22px] items-center gap-1.5 whitespace-nowrap rounded px-2 text-xs font-medium leading-none before:h-1.5 before:w-1.5 before:flex-none before:rounded-full', TAG_TONES[tone])

export function Tag({ tone, title, children, className }: { tone: TagTone; title?: string; children: ReactNode; className?: string }) {
  return <span title={title} className={cn(tag(tone), title && 'cursor-help', className)}>{children}</span>
}

const NOTICE: Record<'warn' | 'info' | 'danger', string> = {
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
  danger: 'bg-danger-soft text-danger',
}
export const notice = (tone: 'warn' | 'info' | 'danger') => cn('rounded-md px-4 py-3 text-sm', NOTICE[tone])

export function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'info'; children: ReactNode }) {
  return <div role="status" className={notice(tone)}>{children}</div>
}

export function Loading({ label: text }: { label: string }) {
  return (
    <div role="status" aria-label={text} className="grid gap-3">
      {[0, 1, 2, 3].map((i) => <span key={i} className="block h-14 animate-pulse rounded bg-surface-2" />)}
    </div>
  )
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className={cn(notice('danger'), 'flex flex-wrap items-center justify-between gap-3')}>
      {message}
      <button type="button" onClick={onRetry} className="min-h-6 font-medium underline underline-offset-2 max-[819px]:min-h-11">Reintentar</button>
    </div>
  )
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-flex min-h-6 items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink max-[819px]:min-h-11">
      <ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />{children}
    </Link>
  )
}

export function PageHeader({ title, intro, back, actions, children }: {
  title: ReactNode
  intro?: ReactNode
  back?: { href: string; label: string }
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="mb-8">
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl">{title}</h1>
          {intro && <p className="mt-1 max-w-[72ch] text-ink-3">{intro}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 max-[819px]:w-full max-[819px]:[&>*]:flex-1">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

/** Label / value pairs on thin lines instead of cards. */
export function Metrics({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid grid-cols-4 gap-x-6 max-[1080px]:grid-cols-3 max-[819px]:grid-cols-2 max-[819px]:gap-x-4', className)}>{children}</dl>
}

export function Metric({ label: name, value, hint: note, children, className, valueClass }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  children?: ReactNode
  className?: string
  valueClass?: string
}) {
  return (
    <div className={cn('min-w-0 border-b border-line py-3', className)}>
      <dt className="text-[13px] text-ink-3">{name}</dt>
      <dd className={cn('mt-0.5 text-lg font-medium tabular-nums', valueClass)}>{value}</dd>
      {children && <dd className="mt-1 grid gap-1 text-[13px] leading-snug text-ink-2">{children}</dd>}
      {note && <dd className="mt-1 text-xs leading-snug text-ink-3">{note}</dd>}
    </div>
  )
}

/** A table that scrolls inside its own box on narrow screens; focusable so the keyboard can scroll it.
 *  `relative` makes it the containing block of sr-only text inside, which would otherwise widen the page. */
export function ScrollTable({ label: name, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div tabIndex={0} role="region" aria-label={`${name} (desplazable)`} className={cn('relative overflow-x-auto focus-visible:outline-offset-0', className)}>
      {children}
    </div>
  )
}

/** Signed amount for results: "+USD 819,38", "−USD 12,00". */
export const signedUsd = (x: number, fmt: (n: number) => string) => `${x > 0 ? '+' : x < 0 ? '−' : ''}USD ${fmt(Math.abs(x))}`
export const signTone = (x: number) => (x > 0 ? 'text-ok' : x < 0 ? 'text-danger' : '')
