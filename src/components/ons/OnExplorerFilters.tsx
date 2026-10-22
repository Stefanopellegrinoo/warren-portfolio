'use client'

import { useState, type ReactNode } from 'react'
import type { ExplorerFilters } from '@/lib/on-explorer-filters'
import { DEFAULT_STATE } from '@/lib/on-explorer-filters'
import { rateTypeLabel } from '@/lib/on-format'
import type { RateType } from '@/lib/on-analytics'
import { btnSecondary, field, label as labelCls } from './ui'

interface Props {
  filters: ExplorerFilters
  issuers: string[]
  currencies: string[]
  onChange: (patch: Partial<ExplorerFilters>) => void
  onReset: () => void
}

const RATE_TYPES: RateType[] = ['fixed', 'step', 'zero', 'floating']
const FIELD = field

function Field({ id, label, children, wide }: { id: string; label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${wide ? 'col-span-2' : ''}`}>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children}
    </div>
  )
}

const toNum = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const isActive = (f: ExplorerFilters) => JSON.stringify(f) !== JSON.stringify(DEFAULT_STATE.filters)

export default function OnExplorerFilters({ filters: f, issuers, currencies, onChange, onReset }: Props) {
  // Phones show the filters behind a toggle so the table is not pushed off-screen.
  const [open, setOpen] = useState(false)
  const num = (id: string, label: string, key: 'ytmMin' | 'ytmMax' | 'mdMin' | 'mdMax') => (
    <Field id={id} label={label}>
      <input id={id} type="number" inputMode="decimal" step="any" className={FIELD} value={f[key] ?? ''} onChange={(e) => onChange({ [key]: toNum(e.target.value) })} />
    </Field>
  )
  return (
    <div className="grid gap-2">
      <button type="button" aria-expanded={open} aria-controls="on-filters" onClick={() => setOpen((o) => !o)} className={`${btnSecondary} w-full min-[820px]:hidden`}>
        {open ? 'Ocultar filtros' : 'Mostrar filtros'}{isActive(f) ? ' (activos)' : ''}
      </button>
      <form id="on-filters" role="search" aria-label="Filtros de ONs" onSubmit={(e) => e.preventDefault()} className={`${open ? 'grid' : 'hidden'} grid-cols-6 gap-x-4 gap-y-3 border-b border-line pb-4 max-[1080px]:grid-cols-4 max-[819px]:grid-cols-2 min-[820px]:grid`}>
        <Field id="on-q" label="Buscar" wide>
          <input id="on-q" type="search" placeholder="Ticker, emisor o ISIN" className={`${FIELD} min-w-0 min-[820px]:min-w-[11rem]`} value={f.q} onChange={(e) => onChange({ q: e.target.value })} />
        </Field>
        <Field id="on-issuer" label="Emisor">
          <select id="on-issuer" className={FIELD} value={f.issuer} onChange={(e) => onChange({ issuer: e.target.value })}>
            <option value="">Todos</option>
            {issuers.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
        <Field id="on-currency" label="Moneda">
          <select id="on-currency" className={FIELD} value={f.currency} onChange={(e) => onChange({ currency: e.target.value })}>
            <option value="">Todas</option>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field id="on-law" label="Ley">
          <select id="on-law" className={FIELD} value={f.law} onChange={(e) => onChange({ law: e.target.value as ExplorerFilters['law'] })}>
            <option value="">Todas</option>
            <option value="ARG">Argentina</option>
            <option value="NY">Nueva York</option>
          </select>
        </Field>
        <Field id="on-rate" label="Tipo de tasa">
          <select id="on-rate" className={FIELD} value={f.rateType} onChange={(e) => onChange({ rateType: e.target.value as ExplorerFilters['rateType'] })}>
            <option value="">Todos</option>
            {RATE_TYPES.map((t) => <option key={t} value={t}>{rateTypeLabel(t)}</option>)}
          </select>
        </Field>
        <Field id="on-mat-from" label="Vence desde">
          <input id="on-mat-from" type="date" className={FIELD} value={f.maturityFrom} onChange={(e) => onChange({ maturityFrom: e.target.value })} />
        </Field>
        <Field id="on-mat-to" label="Vence hasta">
          <input id="on-mat-to" type="date" className={FIELD} value={f.maturityTo} onChange={(e) => onChange({ maturityTo: e.target.value })} />
        </Field>
        {num('on-ytm-min', 'TIR mín. (%)', 'ytmMin')}
        {num('on-ytm-max', 'TIR máx. (%)', 'ytmMax')}
        {num('on-md-min', 'Duración mín.', 'mdMin')}
        {num('on-md-max', 'Duración máx.', 'mdMax')}
        {isActive(f) && (
          <div className="flex items-end">
            <button type="button" onClick={onReset} className={`${btnSecondary} w-full`}>Limpiar filtros</button>
          </div>
        )}
      </form>
    </div>
  )
}
