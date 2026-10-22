'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Search, ChevronLeft, ChevronRight, TrendingUp, Landmark, Banknote } from 'lucide-react'
import { formatNumber, formatUSD } from '@/lib/utils'
import type { Operation, TransactionInput, Cedear, Activo, ONOperation, CashMovementType } from '@/types'
import { postTransaction } from '@/lib/api/post-transaction'
import { EsNumberInput } from '@/components/ui/es-number-input'
import type { PostTransactionResult } from '@/lib/api/post-transaction'
import type { ResolveResult } from '@/lib/ticker-identity'
import type { RetroactiveWarning } from '@/lib/api/retroactive-warning'
import { fmtNum } from '@/lib/on-format'
import { deriveCedearEngineValues, type TradeCurrency } from '@/lib/trade-record'

export type PendingConfirmation = {
  resolution: ResolveResult
  payload: Record<string, unknown>
} | null

/**
 * Decides what `pendingConfirmation` should become after a gated submit
 * resolves. Always returns null unless the result is a fresh 409 needing
 * confirmation — so a stale confirmation from a PREVIOUS attempt on the same
 * form (e.g. one that then succeeded, or failed with a plain error) never
 * lingers on screen. Pure and independent of React state so it is
 * unit-testable without a component-rendering harness (this repo doesn't have
 * one for AddTransactionModal).
 */
export function nextPendingConfirmation(
  result: PostTransactionResult,
  payload: Record<string, unknown>
): PendingConfirmation {
  if (!result.ok && result.kind === 'needs-confirmation') {
    return { resolution: result.resolution, payload }
  }
  return null
}

export const STALE_CONFIRMATION_MESSAGE =
  'El ticker cambió después de la confirmación. Guardá de nuevo para verificarlo.'

/**
 * Gate every confirmed resubmit goes through.
 *
 * A confirmation answers exactly one question — "is THIS ticker the instrument
 * you meant?" — and the payload captured alongside it is a snapshot of the form
 * at the instant the 409 arrived. Nothing stops the user editing the form
 * afterwards. Replaying that snapshot writes the ticker the user just corrected
 * away from, and catalogues it as confirmed: the original UN → "Corgi UNH 2x
 * Daily ETF" bug with a confirmation stamped on it.
 *
 * So the confirm button never replays the snapshot. It rebuilds the payload
 * from LIVE form state and passes it here, which lets it through only while the
 * ticker still matches the one the panel described.
 *
 * Chosen over clearing `pendingConfirmation` inside each field's onChange:
 * that approach is correct only for as long as somebody remembers to wire up
 * every new field, and it is silent when they forget. This is a single
 * checkpoint the payload cannot get past, and it has the side benefit that
 * edits to quantity/price/date reach the server instead of being discarded.
 */
export function confirmedSubmitPayload(
  pending: NonNullable<PendingConfirmation>,
  livePayload: Record<string, unknown>
): { ok: true; payload: Record<string, unknown> } | { ok: false; reason: 'ticker-changed' } {
  const normalize = (value: unknown) => String(value ?? '').toUpperCase().trim()
  const confirmed = normalize(pending.payload.ticker)
  const live = normalize(livePayload.ticker)

  if (!live || live !== confirmed) return { ok: false, reason: 'ticker-changed' }
  return { ok: true, payload: livePayload }
}

/**
 * Clears the transient per-attempt state (validation error + any pending
 * ticker confirmation) whenever the flow navigates away from the form that
 * produced them. Without this, a confirmation panel raised for one asset
 * class/payload survives a back-navigation and can be submitted against a
 * DIFFERENT form's payload — see the back button and asset-class picker call
 * sites. Takes the setters as parameters instead of closing over component
 * state so the invariant is unit-testable without a rendering harness.
 */
export function resetFormNavigationState(
  setError: (value: string) => void,
  setPendingConfirmation: (value: PendingConfirmation) => void
) {
  setError('')
  setPendingConfirmation(null)
}

/**
 * Shared success-completion step for every submit path that can carry a
 * retroactive-entry warning (ACCION/CEDEAR via submitGated, the post-409
 * confirm resubmit, and the ON form — four submit paths funneling through
 * three call sites).
 *
 * `onSuccess` ALWAYS runs first, before either branch: the row was already
 * written by the time this runs, so the dashboard behind this modal is stale
 * from that moment on. Only `onClose` is conditional — a warning holds the
 * modal open so the amber panel can name the days it invalidated; closing is
 * deferred to the "Entendido" button instead.
 *
 * `warnings?.[0]` deliberately reads only the FIRST warning: the server
 * helper (`retroactiveWarnings`) returns at most one today, so this is not
 * dropping anything — but if a second warning code is ever added, silently
 * discarding it here is the failure mode to watch for, not a shortcut to
 * "fix" by grabbing all of them without a panel designed to show more than one.
 *
 * Since this is now the single funnel for every path, one shape guard covers
 * all of them: `warning.staleSnapshots` must actually be an array before it
 * is treated as present. The value arrives from `res.json()` typed `any` —
 * PostTransactionResult's `warnings` field is not runtime-validated — so a
 * drifted server shape (e.g. `staleSnapshots` renamed or omitted) would
 * otherwise reach the panel's `.map()` and throw during render, and this
 * modal has no error boundary.
 *
 * Takes the setters as parameters instead of closing over component state so
 * the invariant is unit-testable without a rendering harness, same reasoning
 * as `resetFormNavigationState` above.
 */
export function completeSubmit(
  warnings: RetroactiveWarning[] | undefined,
  onSuccess: () => void,
  setRetroWarning: (w: RetroactiveWarning) => void,
  onClose: () => void
) {
  onSuccess()
  const warning = warnings?.[0]
  if (warning && Array.isArray(warning.staleSnapshots)) { setRetroWarning(warning); return }
  onClose()
}

/**
 * The panel used to render one `<li>` per stale date, unbounded — with the
 * ONs measured-only backlog at 28 rows today and growing ~21/month, an entry
 * backdated a few months renders a 40+ item list. This is the always-visible
 * summary line that replaces it; the full list still exists, folded inside a
 * `<details>` the user can expand.
 *
 * Assumes `dates` is already sorted ascending — `staleSnapshots()`
 * (`src/lib/retroactive-entry.ts`) guarantees that, and re-sorting here would
 * silently mask a caller that stopped doing so.
 */
export function summarizeStaleSnapshots(dates: string[]): string {
  if (dates.length === 0) return ''
  if (dates.length === 1) return `1 día medido: ${dates[0]}`
  return `${dates.length} días medidos, del ${dates[0]} al ${dates[dates.length - 1]}`
}

// ─────────────────────────────────────────────────────────
// Step 1: asset type selector
// ─────────────────────────────────────────────────────────
type AssetClass = 'ACCION' | 'CEDEAR' | 'ON' | 'CASH'

interface Props {
  onClose: () => void
  onSuccess: () => void
  initialData?: {
    assetClass: AssetClass
    ticker: string
    quantity: number
    price: number
  }
}

const ASSET_CLASSES: { id: AssetClass; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: 'CEDEAR', label: 'CEDEAR', desc: 'Certificados de depósito', icon: <TrendingUp className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" /> },
  { id: 'ON', label: 'Obligación negociable', desc: 'Bonos corporativos en dólares', icon: <Landmark className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" /> },
  { id: 'CASH', label: 'Caja en dólares', desc: 'Depósito o retiro de efectivo', icon: <Banknote className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" /> },
]

const CLASS_NAMES: Record<AssetClass, string> = { ACCION: 'acciones', CEDEAR: 'CEDEAR', ON: 'ON', CASH: 'caja' }
const CHOICE_LABELS: Record<string, string> = {
  COMPRA: 'Compra', VENTA: 'Venta', DIVIDENDO: 'Dividendo', CUPON: 'Cupón', DEPOSITO: 'Depósito', RETIRO: 'Retiro', ARS: 'Pesos', MEP: 'Dólar MEP', CCL: 'Dólar cable',
}

// ─────────────────────────────────────────────────────────
// Presentational pieces (same tokens as the Resumen dialogs)
// ─────────────────────────────────────────────────────────
export const fieldCls = 'min-h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-ink placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_28%,transparent)] focus-visible:outline-none'
const pairCls = 'grid grid-cols-2 gap-3 max-[419px]:grid-cols-1'
export const primaryCls = 'inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-on hover:bg-primary-hover disabled:opacity-70'
export const secondaryCls = 'inline-flex min-h-11 items-center justify-center rounded-md px-4 font-medium text-ink-2 hover:bg-hover hover:text-ink'
const iconBtnCls = 'grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-ink max-[819px]:h-11 max-[819px]:w-11'
const listCls = 'absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-line bg-surface shadow-pop'
const optionCls = 'flex min-h-11 w-full items-center gap-2 border-b border-line px-3 text-left text-[13px] last:border-b-0 hover:bg-hover focus-visible:outline-offset-[-2px]'
const MINUS = '−'

/** Quantities keep their own decimals (up to 6). */
const qty = (n: number) => formatNumber(n, { decimals: Math.min(6, (String(n).split('.')[1] ?? '').length) })

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
      {children}
      {hint}
    </div>
  )
}

export function Choice<T extends string>({ name, legend, options, value, onChange }: {
  name: string; legend: string; options: readonly T[]; value: T; onChange: (v: T) => void
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium">{legend}</legend>
      <div className="flex gap-0.5 rounded-md border border-line bg-surface-2 p-0.5">
        {options.map(o => (
          <label
            key={o}
            className="relative flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded px-3 text-[13px] text-ink-2 has-[:checked]:bg-surface has-[:checked]:font-medium has-[:checked]:text-ink has-[:checked]:shadow-[0_0_0_1px_var(--line)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring max-[819px]:min-h-11"
          >
            <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(o)} className="absolute inset-0 m-0 cursor-pointer opacity-0" />
            {CHOICE_LABELS[o] ?? o}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <input type="text" autoComplete="off" {...props} className={`${fieldCls} pr-9`} />
      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
    </div>
  )
}

function Holding({ held, price }: { held: string; price: number }) {
  return (
    <dl className="grid grid-cols-2 gap-4 border-b border-line pb-4">
      <div>
        <dt className="text-[13px] text-ink-3">Tenés</dt>
        <dd className="font-medium tabular-nums">{held}</dd>
      </div>
      <div className="text-right">
        <dt className="text-[13px] text-ink-3">Precio de mercado</dt>
        <dd className="font-medium tabular-nums">{formatUSD(price)}</dd>
      </div>
    </dl>
  )
}

function Total({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
      <span className="text-[13px] text-ink-2">{label}</span>
      <span className={`font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  )
}

const linkBtnCls = 'inline-flex min-h-8 shrink-0 items-center rounded px-1 font-medium text-accent-ink hover:underline max-[819px]:min-h-11'

/** The trade date's reference MEP / CCL, editable for the rate the broker actually used. */
function FxLine({ fx, tradeDate, edit, onEdit, onChange, onReset }: {
  fx: FxState; tradeDate: string; edit: { mep: number; ccl: number } | null
  onEdit: () => void; onChange: (v: { mep: number; ccl: number }) => void; onReset: () => void
}) {
  if (edit) {
    return (
      <fieldset className="grid gap-2 border-t border-line pt-3">
        <legend className="sr-only">Cotización del dólar</legend>
        <div className={pairCls}>
          <Field id="tx-fx-mep" label="Dólar MEP">
            <EsNumberInput id="tx-fx-mep" placeholder="1.550,80" value={edit.mep || null}
              onValue={n => onChange({ ...edit, mep: n ?? 0 })} className={fieldCls} />
          </Field>
          <Field id="tx-fx-ccl" label="Dólar cable (CCL)">
            <EsNumberInput id="tx-fx-ccl" placeholder="1.636,55" value={edit.ccl || null}
              onValue={n => onChange({ ...edit, ccl: n ?? 0 })} className={fieldCls} />
          </Field>
        </div>
        <button type="button" onClick={onReset} className={`${linkBtnCls} justify-self-start text-[13px]`}>Usar la cotización de referencia</button>
      </fieldset>
    )
  }
  let text = 'Buscando la cotización del dólar…'
  let used: string | undefined
  if (fx.status === 'ok' && (fx.mep || fx.ccl)) {
    used = (fx.ccl ?? fx.mep)!.date
    text = [
      fx.mep && `Dólar MEP del ${dayMonth(fx.mep.date)}: ${formatNumber(fx.mep.rate)}`,
      fx.ccl && `CCL${fx.ccl.date !== fx.mep?.date ? ` del ${dayMonth(fx.ccl.date)}` : ''}: ${formatNumber(fx.ccl.rate)}`,
    ].filter(Boolean).join(' · ')
  } else if (fx.status !== 'loading') {
    text = fx.status === 'error' ? 'No se pudo obtener la cotización del dólar.' : 'No hay cotización del dólar para esa fecha.'
  }
  return (
    <div className="grid gap-1 border-t border-line pt-3 text-[13px]">
      <div className="flex items-center justify-between gap-3">
        <p className="tabular-nums text-ink-2" aria-live="polite">{text}</p>
        <button type="button" onClick={onEdit} aria-label="Editar la cotización del dólar" className={linkBtnCls}>Editar</button>
      </div>
      {used && used !== tradeDate && <p className="text-ink-3">El {dayMonth(tradeDate)} no tiene cotización: se usa la del {dayMonth(used)}.</p>}
    </div>
  )
}

export function FormError({ error }: { error: string }) {
  return error ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p> : null
}

function Submit({ loading, selling }: { loading: boolean; selling: boolean }) {
  return (
    <button type="submit" disabled={loading} aria-busy={loading} className={`${primaryCls} w-full`}>
      {loading ? 'Guardando…' : selling ? 'Confirmar venta' : 'Guardar operación'}
    </button>
  )
}

function TickerConfirmation({ pending, loading, onConfirm, onCancel }: {
  pending: NonNullable<PendingConfirmation>; loading: boolean; onConfirm: () => void; onCancel: () => void
}) {
  const ticker = String(pending.payload.ticker)
  const r = pending.resolution
  return (
    <div role="alert" className="grid gap-3 rounded-md bg-warn-soft px-4 py-3 text-[13px] text-ink">
      {r.found ? (
        <p>
          <b className="font-semibold">{ticker}</b> es <b className="font-semibold">{r.identity.name}</b>
          {r.identity.exchange ? ` (${r.identity.exchange})` : ''} a {formatUSD(r.identity.price)}.
          {' '}¿Es este el instrumento que estás agregando?
        </p>
      ) : (
        <p>
          No se encontró un instrumento para <b className="font-semibold">{ticker}</b>. Se valuará a su propio costo hasta que exista una fuente de precio.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryCls} disabled={loading} onClick={onConfirm}>Sí, agregar</button>
        <button type="button" className={secondaryCls} onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Form state types
// ─────────────────────────────────────────────────────────
const STOCK_OPS: Operation[] = ['COMPRA', 'VENTA', 'DIVIDENDO']
const ON_OPS: ONOperation[] = ['COMPRA', 'VENTA', 'CUPON']
const CASH_OPS: CashMovementType[] = ['DEPOSITO', 'RETIRO']

interface CedearFormData {
  date: string
  ticker: string
  cantidad: number
  precio: number
  moneda: TradeCurrency
  comision: number
  notas: string
}

interface ONFormData {
  date: string
  ticker: string
  operation: ONOperation
  quantity: number
  price: number
  commission: number
  notes: string
}

interface CashFormData {
  date: string
  type: CashMovementType
  amount: number
  description: string
}

type FxQuote = { rate: number; date: string } | null
/** Reference MEP and CCL of the CEDEAR form's trade date (GET /api/fx). */
type FxState = { status: 'loading' | 'missing' | 'error' } | { status: 'ok'; mep: FxQuote; ccl: FxQuote }

export const TRADE_CURRENCIES: readonly TradeCurrency[] = ['ARS', 'MEP', 'CCL']
export const IN_CURRENCY: Record<TradeCurrency, string> = { ARS: 'en pesos', MEP: 'en dólar MEP', CCL: 'en dólar cable' }
const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

// ─────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────
export default function AddTransactionModal({ onClose, onSuccess, initialData }: Props) {
  // Step 1 / Step 2
  const [step, setStep] = useState<1 | 2>(initialData ? 2 : 1)
  const [assetClass, setAssetClass] = useState<AssetClass | null>(initialData?.assetClass ?? null)

  // Filter operations based on mode
  const filteredStockOps = initialData 
    ? STOCK_OPS.filter(op => op === 'VENTA')
    : STOCK_OPS.filter(op => op !== 'VENTA')

  const filteredOnOps = initialData
    ? ON_OPS.filter(op => op === 'VENTA')
    : ON_OPS.filter(op => op !== 'VENTA')

  // ── ACCION state ──
  const [stockOp, setStockOp] = useState<Operation>(initialData ? 'VENTA' : 'COMPRA')
  const [form, setForm] = useState<TransactionInput>({
    date: new Date().toISOString().split('T')[0],
    ticker: initialData?.assetClass === 'ACCION' ? initialData.ticker : '',
    operation: initialData ? 'VENTA' : 'COMPRA',
    quantity: initialData?.assetClass === 'ACCION' ? initialData.quantity : 0,
    price: initialData?.assetClass === 'ACCION' ? initialData.price : 0,
    commission: 0,
    notes: '',
  })
  const [activos, setActivos] = useState<Activo[]>([])
  const [activoSearch, setActivoSearch] = useState(initialData?.assetClass === 'ACCION' ? initialData.ticker : '')
  const [showActivoDropdown, setShowActivoDropdown] = useState(false)

  // ── CEDEAR state ──
  const [cedears, setCedears] = useState<Cedear[]>([])
  const [cedearForm, setCedearForm] = useState<CedearFormData>({
    date: new Date().toISOString().split('T')[0],
    ticker: initialData?.assetClass === 'CEDEAR' ? initialData.ticker : '',
    cantidad: initialData?.assetClass === 'CEDEAR' ? initialData.quantity : 0,
    precio: initialData?.assetClass === 'CEDEAR' ? initialData.price : 0,
    // A quick sell starts from the position, which is in USD-CCL.
    moneda: initialData?.assetClass === 'CEDEAR' ? 'CCL' : 'ARS',
    comision: 0,
    notas: '',
  })
  const [cedearSearch, setCedearSearch] = useState(initialData?.assetClass === 'CEDEAR' ? initialData.ticker : '')
  const [showCedearDropdown, setShowCedearDropdown] = useState(false)
  const [fx, setFx] = useState<FxState>({ status: 'loading' })
  // Rates the user typed over the reference ones; null = not editing.
  const [fxEdit, setFxEdit] = useState<{ mep: number; ccl: number } | null>(null)

  // ── ON state ──
  const [onForm, setOnForm] = useState<ONFormData>({
    date: new Date().toISOString().split('T')[0],
    ticker: initialData?.assetClass === 'ON' ? initialData.ticker : '',
    operation: initialData ? 'VENTA' : 'COMPRA',
    quantity: initialData?.assetClass === 'ON' ? initialData.quantity : 0,
    price: initialData?.assetClass === 'ON' ? initialData.price : 0,
    commission: 0,
    notes: '',
  })
  const [onSearch, setOnSearch] = useState(initialData?.assetClass === 'ON' ? initialData.ticker : '')
  const [onResults, setOnResults] = useState<{ ticker: string; name?: string; source: string }[]>([])
  const [showOnDropdown, setShowOnDropdown] = useState(false)
  const [onSearchLoading, setOnSearchLoading] = useState(false)

  // ── CASH state ──
  const [cashForm, setCashForm] = useState<CashFormData>({
    date: new Date().toISOString().split('T')[0],
    type: 'DEPOSITO',
    amount: 0,
    description: '',
  })

  // ── Shared state ──
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null)
  const [retroWarning, setRetroWarning] = useState<RetroactiveWarning | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  // Native modal dialog: focus trap, Escape and top layer come from the browser.
  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  }, [])

  // ── Fetch activos & cedears ──
  useEffect(() => {
    async function fetchData() {
      try {
        const [activosRes, cedearsRes] = await Promise.all([
          fetch('/api/activos'),
          fetch('/api/cedears'),
        ])
        if (activosRes.ok) setActivos(await activosRes.json())
        if (cedearsRes.ok) {
          const cedearsList = await cedearsRes.json()
          setCedears(cedearsList)

          // If we have initialData for a CEDEAR, adjust quantity based on ratio
          if (initialData?.assetClass === 'CEDEAR') {
            const found = cedearsList.find((c: any) => c.ticker === initialData.ticker)
            if (found && found.ratio) {
              setCedearForm(prev => ({
                ...prev,
                // Shares are stored to 6 decimals: 42.307692 × 26 must read 1100, not 1099.99999.
                cantidad: Math.round(initialData.quantity * found.ratio * 1e4) / 1e4,
                // Price is a bit trickier because of currency, but as a baseline 
                // we show the price per CEDEAR in USD if they switch to USD
                precio: initialData.price / found.ratio
              }))
            }
          }
        }
      } catch (err) {
        console.error('Error fetching data:', err)
      }
    }
    fetchData()
  }, [initialData])

  // ── Reference FX of the CEDEAR trade date ──
  useEffect(() => {
    if (assetClass !== 'CEDEAR' || !cedearForm.date) return
    let cancelled = false
    setFx({ status: 'loading' })
    setFxEdit(null) // typed rates belonged to the previous date
    fetch(`/api/fx?date=${cedearForm.date}`)
      .then(async res => {
        if (res.status === 404) return { status: 'missing' } as const
        if (!res.ok) throw new Error(String(res.status))
        const d = await res.json()
        return { status: 'ok', mep: d.mep ?? null, ccl: d.ccl ?? null } as const
      })
      .catch(() => ({ status: 'error' }) as const)
      .then(next => { if (!cancelled) setFx(next) })
    return () => { cancelled = true }
  }, [assetClass, cedearForm.date])

  // ── Search ONs when user types in ON search field ──
  useEffect(() => {
    if (assetClass !== 'ON' || onSearch.length < 2) {
      setOnResults([])
      return
    }

    const searchONs = async () => {
      setOnSearchLoading(true)
      try {
        const res = await fetch(`/api/ons/search?q=${encodeURIComponent(onSearch)}&limit=10`)
        if (res.ok) {
          const data = await res.json()
          setOnResults(data.results || [])
        } else {
          setOnResults([])
        }
      } catch (err) {
        console.error('Error searching ONs:', err)
        setOnResults([])
      } finally {
        setOnSearchLoading(false)
      }
    }

    const debounce = setTimeout(searchONs, 300)
    return () => clearTimeout(debounce)
  }, [onSearch, assetClass])

  // ── Derived CEDEAR values ──
  const filteredActivos = activos.filter(a =>
    a.ticker.toLowerCase().includes(activoSearch.toLowerCase()) ||
    a.nombre.toLowerCase().includes(activoSearch.toLowerCase())
  )
  const filteredCedears = cedears.filter(c =>
    c.ticker.toLowerCase().includes(cedearSearch.toLowerCase()) ||
    c.nombre.toLowerCase().includes(cedearSearch.toLowerCase())
  )
  const selectedCedear = cedears.find(c => c.ticker === cedearForm.ticker)
  const refMep = fx.status === 'ok' ? fx.mep?.rate ?? null : null
  const refCcl = fx.status === 'ok' ? fx.ccl?.rate ?? null : null
  const fxMep = fxEdit ? fxEdit.mep || null : refMep
  const fxCcl = fxEdit ? fxEdit.ccl || null : refCcl
  // Preview only: the server derives the stored values with the same function.
  let cedearEngine: { quantity: number; price: number; commission: number } | null = null
  if (selectedCedear && cedearForm.cantidad > 0 && cedearForm.precio > 0) {
    try {
      cedearEngine = deriveCedearEngineValues({
        tradeCurrency: cedearForm.moneda, tradeQuantity: cedearForm.cantidad, tradePrice: cedearForm.precio,
        tradeCommission: cedearForm.comision, ratio: selectedCedear.ratio, fxMep, fxCcl,
      })
    } catch { /* the FX this currency needs is missing; the FX line says so */ }
  }
  const cedearTotal = cedearEngine
    ? cedearEngine.quantity * cedearEngine.price + (stockOp === 'VENTA' ? -cedearEngine.commission : cedearEngine.commission)
    : 0

  // ── Payload builders ──
  // Single source for each form's payload, read by BOTH the submit handler and
  // the confirm button. The confirm button must never resubmit a payload the
  // form no longer shows — see confirmedSubmitPayload.

  function buildAccionPayload(): Record<string, unknown> {
    return {
      ...form,
      operation: stockOp,
      ticker: form.ticker.toUpperCase().trim(),
      assetType: 'ACCION',
      moneda: 'USD',
    }
  }

  /** The broker ticket as typed. FX goes only when the user changed it. */
  function buildCedearPayload(): Record<string, unknown> {
    return {
      date: cedearForm.date,
      ticker: cedearForm.ticker,
      operation: stockOp,
      assetType: 'CEDEAR',
      tradeCurrency: cedearForm.moneda,
      tradeQuantity: cedearForm.cantidad,
      tradePrice: cedearForm.precio,
      tradeCommission: cedearForm.comision || 0,
      notes: cedearForm.notas || '',
      ...(fxEdit && fxMep && fxMep !== refMep ? { fxMep } : {}),
      ...(fxEdit && fxCcl && fxCcl !== refCcl ? { fxCcl } : {}),
    }
  }

  // ── Submit handlers ──

  /** Shared 409 handling for every gated submit path. Throws on a real error. */
  async function submitGated(payload: Record<string, unknown>) {
    // Never let a previous attempt's stale confirmation panel render while
    // this one is in flight.
    setPendingConfirmation(null)
    const result = await postTransaction(payload)
    setPendingConfirmation(nextPendingConfirmation(result, payload))
    if (!result.ok && result.kind === 'needs-confirmation') return
    if (!result.ok) throw new Error(result.message)
    completeSubmit(result.warnings, onSuccess, setRetroWarning, onClose)
  }

  /**
   * Shared "Sí, agregar" handler for every confirmation panel. Takes the
   * form's payload builder rather than a captured payload so the submit is
   * always built from what the user is currently looking at.
   */
  async function handleConfirmTicker(buildPayload: () => Record<string, unknown>) {
    if (!pendingConfirmation) return

    const attempt = confirmedSubmitPayload(pendingConfirmation, buildPayload())
    if (!attempt.ok) {
      setPendingConfirmation(null)
      setError(STALE_CONFIRMATION_MESSAGE)
      return
    }

    setError('')
    setLoading(true)
    try {
      const again = await postTransaction({ ...attempt.payload, confirmTicker: true })
      if (!again.ok) {
        setError(
          again.kind === 'error'
            ? again.message
            : 'No se pudo confirmar el ticker. Probá de nuevo.'
        )
        return
      }
      setPendingConfirmation(null)
      completeSubmit(again.warnings, onSuccess, setRetroWarning, onClose)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitAccion(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.ticker.trim()) { setError('Ingresá el ticker'); return }
    if (form.quantity <= 0) { setError('La cantidad debe ser mayor a 0'); return }
    if (form.price <= 0 && stockOp !== 'DIVIDENDO') { setError('El precio debe ser mayor a 0'); return }

    setLoading(true)
    try {
      await submitGated(buildAccionPayload())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitCedear(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!cedearForm.ticker) { setError('Seleccioná un CEDEAR'); return }
    if (cedearForm.cantidad <= 0) { setError('La cantidad debe ser mayor a 0'); return }
    if (cedearForm.precio <= 0) { setError('El precio debe ser mayor a 0'); return }
    if (!cedearEngine) { setError('Falta la cotización del dólar para esa fecha. Cargala con Editar.'); return }

    setLoading(true)
    try {
      await submitGated(buildCedearPayload())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitON(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!onForm.ticker.trim()) { setError('Ingresá el ticker de la ON'); return }
    if (onForm.operation !== 'CUPON' && onForm.quantity <= 0) { setError('La cantidad debe ser mayor a 0'); return }
    if (onForm.price <= 0) { setError('El precio debe ser mayor a 0'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/on-positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...onForm, ticker: onForm.ticker.toUpperCase().trim() }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.error || 'Error al guardar la operación')
      }
      completeSubmit(payload?.warnings, onSuccess, setRetroWarning, onClose)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitCash(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (cashForm.amount <= 0) { setError('El monto debe ser mayor a 0'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cashForm),
      })
      if (!res.ok) {
        let errStr = 'Error al guardar la operación'
        try { const d = await res.json(); if (d.error) errStr = d.error } catch { errStr = await res.text() || errStr }
        throw new Error(errStr)
      }
      onSuccess(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────
  const selling = !!initialData
  const title = retroWarning ? 'Listo' : step === 1 ? 'Nueva operación' : initialData ? `Vender ${initialData.ticker}` : assetClass === 'CASH' ? 'Movimiento de caja' : `Operación con ${CLASS_NAMES[assetClass ?? 'ACCION']}`
  const subtitle = retroWarning ? 'Revisá el aviso' : step === 1 ? 'Elegí el tipo de activo' : initialData ? 'Confirmá los datos de la venta' : 'Completá los datos'
  const stockTotal = (stockOp === 'VENTA' ? form.quantity * form.price - (form.commission ?? 0) : form.quantity * form.price + (form.commission ?? 0))
  const onTotal = (onForm.operation === 'VENTA' ? onForm.quantity * onForm.price - (onForm.commission ?? 0) : onForm.quantity * onForm.price + (onForm.commission ?? 0))

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      aria-labelledby="tx-title"
      className="w-[min(480px,calc(100vw-32px))] rounded-lg border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/30"
    >
      <div className="grid gap-5 p-6 max-[819px]:p-5">
        <div className="flex items-start gap-2">
          {!retroWarning && step === 2 && (
            <button type="button" aria-label="Volver" onClick={() => { setStep(1); resetFormNavigationState(setError, setPendingConfirmation) }} className={`${iconBtnCls} -ml-2`}>
              <ChevronLeft className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="tx-title" className="font-serif text-2xl">{title}</h2>
            <p className="mt-1 text-[13px] text-ink-3">{subtitle}</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className={`${iconBtnCls} -mr-2`}>
            <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {retroWarning && (
          <>
            <div role="alert" className="grid gap-2 rounded-md bg-warn-soft px-4 py-3 text-[13px] text-ink">
              <p className="font-medium text-warn">Operación guardada</p>
              <p>
                Tiene fecha <b className="font-medium tabular-nums">{retroWarning.entryDate}</b> y se cargó
                hoy. Estos días ya se habían medido sin ella, y un día medido no se recalcula:
              </p>
              <p className="font-medium tabular-nums">{summarizeStaleSnapshots(retroWarning.staleSnapshots)}</p>
              {retroWarning.staleSnapshots.length > 1 && (
                <details>
                  <summary className="inline-flex min-h-8 cursor-pointer items-center font-medium text-accent-ink">Ver los días</summary>
                  <ul className="list-disc pl-5 tabular-nums">
                    {retroWarning.staleSnapshots.map(date => <li key={date}>{date}</li>)}
                  </ul>
                </details>
              )}
              <p>
                Tus posiciones y tu efectivo de hoy están bien. Lo que queda desactualizado es el
                historial medido de esos días.
              </p>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => { setRetroWarning(null); onClose() }} className={primaryCls}>Entendido</button>
            </div>
          </>
        )}

        {/* ── STEP 1: Asset Type Selector ── */}
        {!retroWarning && step === 1 && (
          <ul className="border-y border-line">
            {ASSET_CLASSES.map(ac => (
              <li key={ac.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => { setAssetClass(ac.id); setStep(2); resetFormNavigationState(setError, setPendingConfirmation) }}
                  className="flex min-h-14 w-full items-center gap-3 px-2 py-3 text-left hover:bg-hover focus-visible:outline-offset-[-2px]"
                >
                  <span className="text-ink-3">{ac.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{ac.label}</span>
                    <span className="block text-[13px] text-ink-3">{ac.desc}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* ── STEP 2: Forms ── */}
        {!retroWarning && step === 2 && assetClass === 'ACCION' && (
          <form onSubmit={handleSubmitAccion} className="grid gap-4">
            <Choice name="tx-op" legend="Operación" options={filteredStockOps} value={stockOp} onChange={setStockOp} />
            {initialData && <Holding held={`${qty(initialData.quantity)} acciones`} price={initialData.price} />}
            <div className={pairCls}>
              <Field id="tx-date" label="Fecha">
                <input id="tx-date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className={fieldCls} required />
              </Field>
              <Field id="tx-ticker" label="Ticker">
                <div className="relative">
                  <SearchInput id="tx-ticker" placeholder="Buscar acción" value={activoSearch}
                    onChange={e => { setActivoSearch(e.target.value); setShowActivoDropdown(true) }}
                    onFocus={() => setShowActivoDropdown(true)} required />
                  {showActivoDropdown && filteredActivos.length > 0 && (
                    <div className={listCls}>
                      {filteredActivos.slice(0, 10).map(a => (
                        <button key={a.ticker} type="button" className={optionCls}
                          onClick={() => { setForm(f => ({ ...f, ticker: a.ticker })); setActivoSearch(`${a.ticker} - ${a.nombre}`); setShowActivoDropdown(false) }}>
                          <span className="font-semibold">{a.ticker}</span>
                          <span className="truncate text-ink-3">{a.nombre}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
            </div>
            <div className={pairCls}>
              <Field id="tx-quantity" label="Cantidad">
                <EsNumberInput id="tx-quantity" placeholder="10" value={form.quantity || null}
                  onValue={n => setForm(f => ({ ...f, quantity: n ?? 0 }))} className={fieldCls} required />
              </Field>
              <Field id="tx-price" label="Precio en dólares">
                <EsNumberInput id="tx-price" placeholder="190,70" value={form.price || null}
                  onValue={n => setForm(f => ({ ...f, price: n ?? 0 }))} className={fieldCls} required />
              </Field>
            </div>
            <div className={pairCls}>
              <Field id="tx-commission" label="Comisión">
                <EsNumberInput id="tx-commission" placeholder="0" value={form.commission || null}
                  onValue={n => setForm(f => ({ ...f, commission: n ?? 0 }))} className={fieldCls} />
              </Field>
              <Field id="tx-notes" label="Notas">
                <input id="tx-notes" type="text" placeholder="Opcional" value={form.notes ?? ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={fieldCls} />
              </Field>
            </div>
            {form.quantity > 0 && form.price > 0 && (
              <Total label={stockOp === 'VENTA' ? 'Total a recibir' : 'Total estimado'} value={formatUSD(stockTotal)} />
            )}
            {pendingConfirmation && (
              <TickerConfirmation pending={pendingConfirmation} loading={loading}
                onConfirm={() => handleConfirmTicker(buildAccionPayload)} onCancel={() => setPendingConfirmation(null)} />
            )}
            <FormError error={error} />
            <Submit loading={loading} selling={selling} />
          </form>
        )}

        {!retroWarning && step === 2 && assetClass === 'CEDEAR' && (
          <form onSubmit={handleSubmitCedear} className="grid gap-4">
            <Choice name="tx-op" legend="Operación" options={filteredStockOps} value={stockOp} onChange={setStockOp} />
            {initialData && (() => {
              // The position is stored in underlying shares; the broker counts CEDEARs.
              const ratio = Number(cedears.find(c => c.ticker === initialData.ticker)?.ratio) || 1
              return <Holding held={`${qty(Math.round(initialData.quantity * ratio * 1e4) / 1e4)} CEDEARs`} price={initialData.price} />
            })()}
            <div className={pairCls}>
              <Field id="tx-date" label="Fecha">
                <input id="tx-date" type="date" value={cedearForm.date} onChange={e => setCedearForm(f => ({ ...f, date: e.target.value }))} className={fieldCls} required />
              </Field>
              <Field id="tx-ticker" label="CEDEAR">
                <div className="relative">
                  <SearchInput id="tx-ticker" placeholder="Buscar CEDEAR" value={cedearSearch}
                    onChange={e => { setCedearSearch(e.target.value); setShowCedearDropdown(true) }}
                    onFocus={() => setShowCedearDropdown(true)} required />
                  {showCedearDropdown && filteredCedears.length > 0 && (
                    <div className={listCls}>
                      {filteredCedears.map(c => (
                        <button key={c.ticker} type="button" className={optionCls}
                          onClick={() => { setCedearForm(f => ({ ...f, ticker: c.ticker })); setCedearSearch(`${c.ticker} - ${c.nombre}`); setShowCedearDropdown(false) }}>
                          <span className="font-semibold">{c.ticker}</span>
                          <span className="truncate text-ink-3">{c.nombre}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
            </div>
            <Choice name="tx-currency" legend="Moneda" options={TRADE_CURRENCIES} value={cedearForm.moneda} onChange={m => setCedearForm(f => ({ ...f, moneda: m }))} />
            <div className={pairCls}>
              <Field id="tx-quantity" label="Cantidad de CEDEARs"
                hint={cedearEngine && <p className="text-[13px] text-ink-3 tabular-nums">Equivale a {formatNumber(cedearEngine.quantity, { decimals: 4 })} acciones</p>}>
                <EsNumberInput id="tx-quantity" placeholder="10" value={cedearForm.cantidad || null}
                  onValue={n => setCedearForm(f => ({ ...f, cantidad: n ?? 0 }))} className={fieldCls} required />
              </Field>
              <Field id="tx-price" label={`Precio por CEDEAR ${IN_CURRENCY[cedearForm.moneda]}`}>
                <EsNumberInput id="tx-price" placeholder={cedearForm.moneda === 'ARS' ? '28.080,50' : '10,50'} value={cedearForm.precio || null}
                  onValue={n => setCedearForm(f => ({ ...f, precio: n ?? 0 }))} className={fieldCls} required />
              </Field>
            </div>
            <div className={pairCls}>
              <Field id="tx-commission" label={`Comisión ${IN_CURRENCY[cedearForm.moneda]}`}>
                <EsNumberInput id="tx-commission" placeholder="0" value={cedearForm.comision || null}
                  onValue={n => setCedearForm(f => ({ ...f, comision: n ?? 0 }))} className={fieldCls} />
              </Field>
              <Field id="tx-notes" label="Notas">
                <input id="tx-notes" type="text" placeholder="Opcional" value={cedearForm.notas}
                  onChange={e => setCedearForm(f => ({ ...f, notas: e.target.value }))} className={fieldCls} />
              </Field>
            </div>
            <FxLine fx={fx} tradeDate={cedearForm.date} edit={fxEdit}
              onEdit={() => setFxEdit({ mep: refMep ?? 0, ccl: refCcl ?? 0 })}
              onChange={setFxEdit} onReset={() => setFxEdit(null)} />
            {selectedCedear && cedearEngine && (
              <dl className="grid gap-1 border-t border-line pt-3 text-[13px]">
                <div className="flex justify-between gap-3"><dt className="text-ink-3">Ratio</dt><dd className="tabular-nums">{qty(selectedCedear.ratio)} CEDEARs por acción</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-3">Precio por acción en dólar cable</dt><dd className="font-medium tabular-nums">{formatUSD(cedearEngine.price)}</dd></div>
              </dl>
            )}
            {cedearEngine && (
              <Total label={stockOp === 'VENTA' ? 'A recibir en la cartera' : 'Inversión en la cartera'} value={formatUSD(cedearTotal)} />
            )}
            {pendingConfirmation && (
              <TickerConfirmation pending={pendingConfirmation} loading={loading}
                onConfirm={() => handleConfirmTicker(buildCedearPayload)} onCancel={() => setPendingConfirmation(null)} />
            )}
            <FormError error={error} />
            <Submit loading={loading} selling={selling} />
          </form>
        )}

        {!retroWarning && step === 2 && assetClass === 'ON' && (
          <form onSubmit={handleSubmitON} className="grid gap-4">
            <Choice name="tx-op" legend="Operación" options={filteredOnOps} value={onForm.operation} onChange={op => setOnForm(f => ({ ...f, operation: op }))} />
            {/* ON ledger quantity = VN / 100 */}
            {initialData && <Holding held={`${fmtNum(initialData.quantity * 100, 0)} VN`} price={initialData.price} />}
            <div className={pairCls}>
              <Field id="tx-date" label="Fecha">
                <input id="tx-date" type="date" value={onForm.date} onChange={e => setOnForm(f => ({ ...f, date: e.target.value }))} className={fieldCls} required />
              </Field>
              <Field id="tx-ticker" label="Ticker de la ON">
                <div className="relative">
                  <SearchInput id="tx-ticker" placeholder="Buscar ON" value={onSearch}
                    onChange={e => { setOnSearch(e.target.value.toUpperCase()); setShowOnDropdown(true) }}
                    onFocus={() => setShowOnDropdown(true)} required />
                  {showOnDropdown && onResults.length > 0 && (
                    <div className={listCls}>
                      {onResults.map(on => (
                        <button key={on.ticker} type="button" className={optionCls}
                          onClick={() => { setOnForm(f => ({ ...f, ticker: on.ticker })); setOnSearch(on.ticker); setShowOnDropdown(false) }}>
                          <span className="font-semibold">{on.ticker}</span>
                          {on.name && <span className="truncate text-ink-3">{on.name}</span>}
                          <span className="ml-auto text-xs text-ink-3">{on.source}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {showOnDropdown && onSearchLoading && <div className={`${listCls} px-3 py-2 text-[13px] text-ink-3`}>Buscando…</div>}
                  {showOnDropdown && !onSearchLoading && onSearch.length >= 2 && onResults.length === 0 && (
                    <div className={`${listCls} px-3 py-2 text-[13px] text-ink-3`}>No se encontraron ONs</div>
                  )}
                </div>
              </Field>
            </div>
            <div className={pairCls}>
              <Field id="tx-quantity" label={onForm.operation === 'CUPON' ? 'Monto del cupón en dólares' : 'Cantidad (nominales / 100)'}>
                <EsNumberInput id="tx-quantity" placeholder={onForm.operation === 'CUPON' ? '500' : '200'}
                  value={onForm.quantity || null} onValue={n => setOnForm(f => ({ ...f, quantity: n ?? 0 }))} className={fieldCls} required />
              </Field>
              <Field id="tx-price" label={onForm.operation === 'CUPON' ? 'Precio unitario' : 'Precio (× 100)'}>
                <EsNumberInput id="tx-price" placeholder={onForm.operation === 'CUPON' ? '1' : '98,50'}
                  value={onForm.price || null} onValue={n => setOnForm(f => ({ ...f, price: n ?? 0 }))} className={fieldCls} required />
              </Field>
            </div>
            {onForm.operation !== 'CUPON' && (
              <div className={pairCls}>
                <Field id="tx-commission" label="Comisión">
                  <EsNumberInput id="tx-commission" placeholder="0" value={onForm.commission || null}
                    onValue={n => setOnForm(f => ({ ...f, commission: n ?? 0 }))} className={fieldCls} />
                </Field>
                <Field id="tx-notes" label="Notas">
                  <input id="tx-notes" type="text" placeholder="Opcional" value={onForm.notes}
                    onChange={e => setOnForm(f => ({ ...f, notes: e.target.value }))} className={fieldCls} />
                </Field>
              </div>
            )}
            {onForm.quantity > 0 && onForm.price > 0 && (
              <Total label={onForm.operation === 'CUPON' ? 'Monto del cupón' : onForm.operation === 'VENTA' ? 'Total a recibir' : 'Total estimado'} value={formatUSD(onTotal)} />
            )}
            <FormError error={error} />
            <Submit loading={loading} selling={selling} />
          </form>
        )}

        {!retroWarning && step === 2 && assetClass === 'CASH' && (
          <form onSubmit={handleSubmitCash} className="grid gap-4">
            <Choice name="tx-cash" legend="Tipo de movimiento" options={CASH_OPS} value={cashForm.type} onChange={op => setCashForm(f => ({ ...f, type: op }))} />
            <div className={pairCls}>
              <Field id="tx-date" label="Fecha">
                <input id="tx-date" type="date" value={cashForm.date} onChange={e => setCashForm(f => ({ ...f, date: e.target.value }))} className={fieldCls} required />
              </Field>
              <Field id="tx-amount" label="Monto en dólares">
                <EsNumberInput id="tx-amount" placeholder="1.000,00" value={cashForm.amount || null}
                  onValue={n => setCashForm(f => ({ ...f, amount: n ?? 0 }))} className={fieldCls} required />
              </Field>
            </div>
            <Field id="tx-description" label="Descripción">
              <input id="tx-description" type="text" placeholder="Ej: transferencia desde el banco" value={cashForm.description}
                onChange={e => setCashForm(f => ({ ...f, description: e.target.value }))} className={fieldCls} />
            </Field>
            {cashForm.amount > 0 && (
              <Total
                label={cashForm.type === 'DEPOSITO' ? 'Saldo aumentará' : 'Saldo disminuirá'}
                value={`${cashForm.type === 'DEPOSITO' ? '+' : MINUS}US$ ${formatNumber(cashForm.amount)}`}
                tone={cashForm.type === 'DEPOSITO' ? 'text-ok' : 'text-danger'}
              />
            )}
            <FormError error={error} />
            <Submit loading={loading} selling={selling} />
          </form>
        )}
      </div>
    </dialog>
  )
}
