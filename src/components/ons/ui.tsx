import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtPct } from '@/lib/on-format'

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

// odd/tasks/ux-ons-y-operaciones.md S1: the three views of the section, on the pages that are views
// (detail pages keep a back link instead).
const ONS_TABS = [
  { key: 'mi-cartera', href: '/ons/mi-cartera', label: 'Mis ONs' },
  { key: 'explorar', href: '/ons', label: 'Explorar' },
  { key: 'carteras', href: '/ons/carteras', label: 'Carteras de prueba' },
] as const
export type OnsTab = (typeof ONS_TABS)[number]['key']

export function OnsTabs({ current }: { current: OnsTab }) {
  return (
    <nav aria-label="Secciones de obligaciones negociables" className="mt-5 flex gap-1 overflow-x-auto border-b border-line">
      {ONS_TABS.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? 'page' : undefined}
          className={cn(
            'relative inline-flex min-h-11 flex-none items-center whitespace-nowrap px-3 text-sm font-medium text-ink-2 hover:text-ink max-[400px]:px-2 max-[400px]:text-[13px]',
            t.key === current && 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent max-[400px]:after:inset-x-2',
          )}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

/**
 * A collapsed section (S2-S6): native <details>, so a tap opens it without script and the browser's
 * find-in-page still reaches its text. `summary` is one line saying what is inside.
 */
export function Disclosure({ id, title, count, summary, defaultOpen = false, children, className }: {
  id?: string
  title: string
  count?: number
  summary?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <details id={id} open={defaultOpen || undefined} className={cn('group min-w-0 border-b border-line', className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <h2 className="inline text-base font-semibold tracking-[-0.005em]">{title}</h2>
          {count !== undefined && <span className="ml-1 text-ink-3">{count}</span>}
          {summary && <span className="mt-0.5 block text-[13px] text-ink-3">{summary}</span>}
        </span>
        <ChevronDown className="h-4 w-4 flex-none text-ink-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" strokeWidth={1.5} aria-hidden="true" />
      </summary>
      <div className="pb-6 pt-2">{children}</div>
    </details>
  )
}

/** Same shape as the Resumen distribution: name, thin bar, percentage. */
export function Bars({ rows, label: name }: { rows: { key: string; name: string; pct: number; detail: string }[]; label: string }) {
  return (
    <ul aria-label={name}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_96px_56px] items-center gap-x-3 gap-y-0.5 border-b border-line py-2.5 last:border-b-0 max-[819px]:grid-cols-[minmax(0,1fr)_auto]">
          <span className="min-w-0 truncate font-medium">{r.name}</span>
          <span className="relative h-1 overflow-hidden rounded-full bg-line max-[819px]:col-span-2 max-[819px]:row-start-2 max-[819px]:my-1" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(100, r.pct)}%` }} />
          </span>
          <span className="text-right text-[13px] tabular-nums text-ink-2 max-[819px]:col-start-2 max-[819px]:row-start-1">{fmtPct(r.pct, 1)}</span>
          <span className="col-span-3 text-[13px] text-ink-3 max-[819px]:col-span-2 max-[819px]:row-start-3">{r.detail}</span>
        </li>
      ))}
    </ul>
  )
}

// S6: the explanations that used to live only in `title=` tooltips, which never show on a phone.
export const ON_GLOSSARY = {
  'TIR': 'Cuánto rinde por año la ON si la comprás hoy a este precio y la tenés hasta el final, cobrando todos los pagos. Sirve para comparar ONs entre sí.',
  'Duración': 'Cuánto se mueve el precio si cambian las tasas: con duración 3, si las tasas suben un punto el precio baja cerca de un 3 %. A más duración, más riesgo de precio.',
  'Vida promedio': 'En cuántos años, en promedio, te devuelven el capital. Es más corta que el plazo al vencimiento cuando la ON devuelve el capital en cuotas.',
  'Valor nominal (VN)': 'La cantidad de la ON que tenés o comprás. Los precios se expresan cada 100 de valor nominal.',
  'Lámina mínima': 'La menor cantidad de valor nominal que se puede comprar.',
  'Cupón': 'El pago de intereses, en las fechas del cronograma.',
  'Amortización': 'La devolución del capital. Algunas ONs lo devuelven todo al vencimiento y otras en cuotas.',
  'Tipo de tasa': 'Fija: el cupón no cambia. Step up: el cupón sube en fechas previstas. Cupón cero: no paga intereses, se compra con descuento. Variable: depende de una tasa de referencia, por eso no se puede simular.',
  'Ley': 'La ley que rige la ON, Nueva York o Argentina: define qué tribunales intervienen si la empresa no paga.',
  'Plaza de pago': 'Dónde paga la empresa: en dólar MEP (una cuenta en Argentina) o en dólar cable (una cuenta en el exterior).',
  'Precio sucio y limpio': 'El sucio incluye los intereses que se acumularon desde el último cupón; el limpio no. Lo que pagás al comprar es el sucio.',
  'Valor técnico': 'Lo que vale la ON según sus condiciones: el capital que falta devolver más los intereses acumulados.',
  'Paridad': 'El precio dividido por el valor técnico. Debajo de 100 % la ON cotiza con descuento; arriba, con prima.',
  'Tasa corriente': 'El cupón anual dividido por el precio. No tiene en cuenta lo que ganás o perdés entre el precio y lo que te devuelven al final.',
  'Spread': 'Cuánto más rinde la ON que un bono del Estado de plazo parecido: lo que te pagan por el riesgo de la empresa.',
  'YTW': 'El rendimiento en el peor caso: si la empresa rescata la ON antes de tiempo en la fecha que menos te conviene.',
  'Duración Macaulay': 'El plazo promedio, en años, en que cobrás los pagos, pesado por su valor. La duración de arriba sale de esta.',
  'Convexidad': 'Un ajuste fino de la duración para cambios grandes de tasa. Para comparar ONs alcanza con la TIR y la duración.',
} as const
export type GlossaryTerm = keyof typeof ON_GLOSSARY

/** The collapsed "¿Qué significa cada dato?" of an ONs page, with only the terms that page shows. */
export function Glossary({ terms }: { terms: GlossaryTerm[] }) {
  return (
    <Disclosure id="glosario" title="¿Qué significa cada dato?">
      <dl className="grid max-w-[80ch] gap-3">
        {terms.map((t) => (
          <div key={t}>
            <dt className="font-medium">{t}</dt>
            <dd className="text-ink-2">{ON_GLOSSARY[t]}</dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  )
}
