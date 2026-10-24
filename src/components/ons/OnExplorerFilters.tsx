'use client'

import { useState, type ReactNode } from 'react'
import { Check, Search, SlidersHorizontal } from 'lucide-react'
import type { ExplorerFilters } from '@/lib/on-explorer-filters'
import { activeFilterCount, presetActive, PRESETS, togglePreset } from '@/lib/on-explorer-filters'
import { rateTypeLabel } from '@/lib/on-format'
import type { RateType } from '@/lib/on-analytics'
import { EsNumberInput } from '@/components/ui/es-number-input'
import { cn } from '@/lib/utils'
import { btnQuiet, btnSecondary, field, label as labelCls } from './ui'

interface Props {
  filters: ExplorerFilters
  issuers: string[]
  currencies: string[]
  today: string // ISO, Argentina: the base of the "Vencen en 2 años o menos" preset
  resultCount: number
  onChange: (patch: Partial<ExplorerFilters>) => void
  onReset: () => void
}

const RATE_TYPES: RateType[] = ['fixed', 'step', 'zero', 'floating']
const CHIP =
  'inline-flex min-h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-md border border-line px-3 text-[13px] text-ink-2 hover:bg-hover hover:text-ink ' +
  'aria-pressed:border-line-strong aria-pressed:bg-surface-2 aria-pressed:font-medium aria-pressed:text-ink max-[819px]:min-h-11'

function Field({ id, label, children, className }: { id: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children}
    </div>
  )
}

/** odd/tasks/ux-ons-y-operaciones.md S4: search first and always visible; the rest behind "Filtros · N". */
export default function OnExplorerFilters({ filters: f, issuers, currencies, today, resultCount, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false)
  // Remounts the number fields on "Limpiar": an es-AR field that reads "0" would otherwise keep its text.
  const [resets, setResets] = useState(0)
  const count = activeFilterCount(f)
  const reset = () => { setResets((n) => n + 1); onReset() }
  const num = (id: string, label: string, key: 'ytmMin' | 'ytmMax' | 'mdMin' | 'mdMax') => (
    <Field id={id} label={label}>
      <EsNumberInput key={resets} id={id} className={field} value={f[key]} allowNegative={key.startsWith('ytm')} onValue={(n) => onChange({ [key]: n })} />
    </Field>
  )
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div role="search" aria-label="Buscar y filtrar ONs" className="flex flex-wrap items-center gap-2">
        <label htmlFor="on-q" className="sr-only">Buscar</label>
        <div className="relative min-w-0 basis-full min-[820px]:max-w-md min-[820px]:flex-[1_1_18rem]">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.5} />
          <input id="on-q" type="search" placeholder="Buscar por ticker, emisor o ISIN" autoComplete="off" className={cn(field, 'pl-9')} value={f.q} onChange={(e) => onChange({ q: e.target.value })} />
        </div>
        {/* One row that scrolls inside its own box when it does not fit, so the chips never widen the page. */}
        <div className="-my-1 flex min-w-0 flex-[1_1_auto] items-center gap-2 overflow-x-auto py-1">
          <button type="button" aria-expanded={open} aria-controls="on-filters" onClick={() => setOpen((o) => !o)} className={cn(btnSecondary, 'flex-none', count > 0 && 'border-ink')}>
            <SlidersHorizontal aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            Filtros{count > 0 && <span className="tabular-nums"> · {count}<span className="sr-only"> activos</span></span>}
          </button>
          {(count > 0 || f.q.trim() !== '') && <button type="button" onClick={reset} className={cn(btnQuiet, 'flex-none')}>Limpiar</button>}
          <span aria-hidden className="mx-1 h-6 w-px flex-none bg-line" />
          <div role="group" aria-label="Atajos de filtro" className="flex flex-none gap-2">
            {PRESETS.map((p) => {
              const on = presetActive(f, p, today)
              return (
                <button key={p.id} type="button" aria-pressed={on} onClick={() => onChange(togglePreset(f, p, today))} className={CHIP}>
                  {on && <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />}
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <form id="on-filters" aria-label="Filtros de ONs" hidden={!open} onSubmit={(e) => { e.preventDefault(); setOpen(false) }}
        className={cn(open ? 'grid' : 'hidden', 'grid-cols-6 gap-x-4 gap-y-3 border-y border-line py-4 max-[1080px]:grid-cols-4 max-[819px]:grid-cols-2')}>
        <Field id="on-currency" label="Moneda">
          <select id="on-currency" className={field} value={f.currency} onChange={(e) => onChange({ currency: e.target.value })}>
            <option value="">Todas</option>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field id="on-law" label="Ley">
          <select id="on-law" className={field} value={f.law} onChange={(e) => onChange({ law: e.target.value as ExplorerFilters['law'] })}>
            <option value="">Todas</option>
            <option value="ARG">Argentina</option>
            <option value="NY">Nueva York</option>
          </select>
        </Field>
        <Field id="on-rate" label="Tipo de tasa">
          <select id="on-rate" className={field} value={f.rateType} onChange={(e) => onChange({ rateType: e.target.value as ExplorerFilters['rateType'] })}>
            <option value="">Todos</option>
            {RATE_TYPES.map((t) => <option key={t} value={t}>{rateTypeLabel(t)}</option>)}
          </select>
        </Field>
        <Field id="on-issuer" label="Emisor" className="col-span-2 max-[1080px]:col-span-1">
          <select id="on-issuer" className={field} value={f.issuer} onChange={(e) => onChange({ issuer: e.target.value })}>
            <option value="">Todos</option>
            {issuers.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
        <div aria-hidden className="max-[1080px]:hidden" />
        <Field id="on-mat-from" label="Vence desde">
          <input id="on-mat-from" type="date" className={field} value={f.maturityFrom} onChange={(e) => onChange({ maturityFrom: e.target.value })} />
        </Field>
        <Field id="on-mat-to" label="Vence hasta">
          <input id="on-mat-to" type="date" className={field} value={f.maturityTo} onChange={(e) => onChange({ maturityTo: e.target.value })} />
        </Field>
        {num('on-ytm-min', 'TIR mín. (%)', 'ytmMin')}
        {num('on-ytm-max', 'TIR máx. (%)', 'ytmMax')}
        {num('on-md-min', 'Duración mín. (años)', 'mdMin')}
        {num('on-md-max', 'Duración máx. (años)', 'mdMax')}
        <div className="col-span-full flex flex-wrap items-center justify-end gap-2">
          <button type="submit" className={cn(btnSecondary, 'max-[819px]:flex-1')}>Ver {resultCount} {resultCount === 1 ? 'ON' : 'ONs'}</button>
        </div>
      </form>
    </div>
  )
}
