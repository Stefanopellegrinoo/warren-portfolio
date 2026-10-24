'use client'

import { useId, useState } from 'react'
import { fmtDate } from '@/lib/on-format'
import { formatUSD } from '@/lib/utils'
import type { MissingGroup, PaymentLine } from '@/lib/on-payments'
import type { PaymentKind } from '@/lib/ledger-core'
import { EsNumberInput } from '@/components/ui/es-number-input'
import { SectionHead } from '@/components/resumen/ui'
import { useCached } from '@/lib/client-cache'
import { api, apiData } from './portfolios/api'
import { btnPrimary, btnQuiet, btnSecondary, field, hint, label, LoadError, notice } from './ui'

// ONs → Mi cartera, "Pagos cobrados" (odd/tasks/nucleo-ledger.md S8, S10): the automatic coupons and
// amortizations, the user's corrections, and the payments the bond calendar says are missing.

export type OnPaymentsData = { payments: PaymentLine[]; missing: MissingGroup[] }
export type PaymentKey = { ticker: string; pay_date: string; kind: PaymentKind }
/** Resolves to an error message, or null when it worked. */
type Save = (key: PaymentKey & { amount: number | null }) => Promise<string | null>
type Revert = (key: PaymentKey) => Promise<string | null>

const KIND: Record<PaymentKind, string> = { coupon: 'Cupón', amortization: 'Amortización' }
const round2 = (x: number) => Math.round(x * 100) / 100
// Latest first, five at a time, like the Resumen's movements: a long history must not bury the page.
const PAGE_SIZE = 5
const linkBtn = 'min-h-6 whitespace-nowrap font-medium text-accent-ink underline underline-offset-2 max-[819px]:min-h-11'

export function OnPaymentsView({ data, onSave, onRevert }: { data: OnPaymentsData; onSave: Save; onRevert: Revert }) {
  const [open, setOpen] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE_SIZE)
  const { payments, missing } = data
  if (payments.length === 0 && missing.length === 0) return null
  const close = () => setOpen(null)

  return (
    <section aria-labelledby="mc-pagos">
      <SectionHead id="mc-pagos" title="Pagos cobrados" count={payments.length} />
      <ul>
        {missing.map((g) => {
          const id = `m:${g.ticker}`
          return [
            <li key={id} className={`${notice('warn')} mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1`}>
              <p><span aria-hidden="true">⚠ </span>Faltan pagos de {g.ticker}: {g.payments.map((m) => fmtDate(m.date)).join(', ')}</p>
              <button type="button" className={linkBtn} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>Cargar</button>
            </li>,
            open === id && (
              <li key={`${id}:form`} className="py-3">
                <PaymentForm title={`Pago de ${g.ticker}`} options={g.payments} kind="coupon" initial={g.payments[0].estimate}
                  notReceived={false} chooseKind onSave={(k) => onSave(k)} onDone={close} ticker={g.ticker} />
              </li>
            ),
          ]
        })}
        {payments.slice(0, shown).map((p) => {
          const id = `p:${p.ticker}|${p.date}|${p.kind}`
          const key = { ticker: p.ticker, pay_date: p.date, kind: p.kind }
          return [
            <li key={id} data-payment className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-line py-2 tabular-nums">
              <span className="min-w-0">
                <span className="font-semibold">{p.ticker}</span> <span className="text-ink-3">· {KIND[p.kind]}</span>
                <span className="block text-[13px] text-ink-3">{fmtDate(p.date)}</span>
              </span>
              <span className="text-right">
                <span className={`block ${p.amount === null ? 'text-ink-3' : 'font-medium'}`}>{p.amount === null ? 'No lo cobré' : formatUSD(p.amount)}</span>
                <button type="button" className={`${linkBtn} text-[13px]`} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
                  {p.corrected ? 'Corregido por vos' : 'Corregir'}
                </button>
              </span>
            </li>,
            open === id && (
              <li key={`${id}:form`} className="border-b border-line py-3">
                <PaymentForm
                  title={`${KIND[p.kind]} de ${p.ticker} del ${fmtDate(p.date)}`}
                  options={[{ date: p.date, estimate: null }]} kind={p.kind} initial={p.amount === null ? null : round2(p.amount)}
                  notReceived={p.amount === null}
                  onSave={(k) => onSave(k)} onRevert={p.corrected ? () => onRevert(key) : undefined} onDone={close} ticker={p.ticker}
                />
              </li>
            ),
          ]
        })}
      </ul>
      {payments.length > shown && (
        <button type="button" className={`${btnSecondary} mt-3 w-full`} onClick={() => setShown((n) => n + PAGE_SIZE)}>
          Ver {Math.min(PAGE_SIZE, payments.length - shown)} más
        </button>
      )}
    </section>
  )
}

function PaymentForm({ title, ticker, options, kind: initialKind, initial, notReceived, chooseKind = false, onSave, onRevert, onDone }: {
  title: string
  ticker: string
  options: { date: string; estimate: number | null }[]
  kind: PaymentKind
  initial: number | null
  notReceived: boolean
  chooseKind?: boolean
  onSave: Save
  onRevert?: () => Promise<string | null>
  onDone: () => void
}) {
  const uid = useId()
  const [date, setDate] = useState(options[0].date)
  const [kind, setKind] = useState<PaymentKind>(initialKind)
  const [received, setReceived] = useState(!notReceived)
  const [amount, setAmount] = useState<number | null>(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const estimate = options.find((o) => o.date === date)?.estimate ?? null
  const choose = options.length > 1

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true)
    const failure = await action()
    setBusy(false)
    if (failure) setError(failure)
    else onDone()
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (received && !(amount && amount > 0)) return setError('Ingresá el monto que pagó el broker')
    setError('')
    void run(() => onSave({ ticker, pay_date: date, kind, amount: received ? amount : null }))
  }

  return (
    <form onSubmit={submit} className="grid max-w-[480px] gap-4" aria-label={title}>
      <p className="font-medium">{title}</p>
      {(choose || chooseKind) && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 min-[480px]:grid-cols-2">
          {choose && (
            <div className="grid gap-1.5">
              <label htmlFor={`${uid}-date`} className={label}>Fecha del pago</label>
              <select id={`${uid}-date`} value={date} className={field}
                onChange={(e) => { setDate(e.target.value); setAmount(options.find((o) => o.date === e.target.value)?.estimate ?? null) }}>
                {options.map((o) => <option key={o.date} value={o.date}>{fmtDate(o.date)}</option>)}
              </select>
            </div>
          )}
          {chooseKind && (
            <div className="grid gap-1.5">
              <label htmlFor={`${uid}-kind`} className={label}>Tipo de pago</label>
              <select id={`${uid}-kind`} value={kind} className={field} onChange={(e) => setKind(e.target.value as PaymentKind)}>
                <option value="coupon">Cupón</option>
                <option value="amortization">Amortización</option>
              </select>
            </div>
          )}
        </div>
      )}
      <fieldset className="grid gap-2">
        <legend className={`${label} mb-1.5`}>¿Qué pagó el broker?</legend>
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm max-[819px]:min-h-11">
          <input type="radio" name={`${uid}-received`} checked={received} onChange={() => setReceived(true)} /> Cobré este monto
        </label>
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm max-[819px]:min-h-11">
          <input type="radio" name={`${uid}-received`} checked={!received} onChange={() => setReceived(false)} /> No lo cobré
        </label>
      </fieldset>
      {received && (
        <div className="grid gap-1.5">
          <label htmlFor={`${uid}-amount`} className={label}>Monto que pagó el broker (US$)</label>
          <EsNumberInput id={`${uid}-amount`} value={amount} onValue={setAmount} className={field} inputMode="decimal" aria-describedby={estimate !== null ? `${uid}-est` : undefined} />
          {estimate !== null && <p id={`${uid}-est`} className={hint}>Estimado por la app: {formatUSD(estimate)}. Revisá lo que te pagó el broker.</p>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary} disabled={busy}>Guardar</button>
        {onRevert && <button type="button" className={btnSecondary} disabled={busy} onClick={() => void run(onRevert)}>Volver al automático</button>}
        <button type="button" className={btnQuiet} disabled={busy} onClick={onDone}>Cancelar</button>
      </div>
    </form>
  )
}

/**
 * Loads the paid and missing payments and saves corrections; shared by Mis ONs (its summary shows what is missing).
 * Seen before in this tab, they show at once; a change answers with the payments after it (odd/tasks/rendimiento.md S9).
 */
export function useOnPayments() {
  const { data, error, reload, mutate } = useCached('ons:payments', () => apiData<OnPaymentsData>('/api/ons/pagos'))

  const after = (r: { ok: boolean; error?: string; data?: Partial<OnPaymentsData> }) => {
    if (!r.ok) return r.error ?? 'No se pudo guardar'
    // Without the payments in the answer, ask for them again.
    if (r.data?.payments && r.data.missing) mutate({ payments: r.data.payments, missing: r.data.missing })
    else reload()
    return null
  }
  const onSave: Save = async (body) => after(await api<Partial<OnPaymentsData>>('/api/ons/pagos', { method: 'PUT', body }))
  const onRevert: Revert = async (k) => after(await api<Partial<OnPaymentsData> | undefined>(`/api/ons/pagos?${new URLSearchParams({ ...k, view: '1' })}`, { method: 'DELETE' }))
  return { data, failed: !data && !!error, load: reload, onSave, onRevert }
}

export default function OnPayments({ state }: { state: ReturnType<typeof useOnPayments> }) {
  const { data, failed, load, onSave, onRevert } = state
  if (failed) return <LoadError message="No se pudieron cargar tus pagos de ONs." onRetry={() => void load()} />
  if (!data) return null
  return <OnPaymentsView data={data} onSave={onSave} onRevert={onRevert} />
}
