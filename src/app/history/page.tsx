'use client'

import { useState, Fragment } from 'react'
import { toast } from 'sonner'
import { requestErrorMessage } from '@/lib/request-errors'
import { useCached } from '@/lib/client-cache'
import { InlineConfirm } from '@/components/ui/InlineConfirm'
import { Trash2 } from 'lucide-react'
import { formatDate, formatNumber, formatPct, formatUSD } from '@/lib/utils'
import type { ClosedTrade, Transaction } from '@/types'
import { afterSplitsText } from '@/lib/after-splits'
import { ReviewFix } from './review-fix'

type ClosedSortKey = 'ticker' | 'open_date' | 'close_date' | 'days_held' | 'avg_cost' | 'close_price' | 'quantity' | 'invested' | 'proceeds' | 'pnl' | 'pnl_pct'
type AllSortKey = 'date' | 'ticker' | 'operation' | 'quantity' | 'price' | 'commission' | 'created_at'
type Sort<K> = { key: K; dir: 'asc' | 'desc' }
type Column<K> = { label: string; key: K; numeric: boolean }

const CLOSED_COLUMNS: Column<ClosedSortKey>[] = [
  { label: 'Activo', key: 'ticker', numeric: false },
  { label: 'Compra', key: 'open_date', numeric: false },
  { label: 'Venta', key: 'close_date', numeric: false },
  { label: 'Días', key: 'days_held', numeric: true },
  { label: 'Costo prom.', key: 'avg_cost', numeric: true },
  { label: 'Precio de cierre', key: 'close_price', numeric: true },
  { label: 'Cantidad', key: 'quantity', numeric: true },
  { label: 'Invertido', key: 'invested', numeric: true },
  { label: 'Retorno', key: 'proceeds', numeric: true },
  { label: 'Resultado', key: 'pnl', numeric: true },
  { label: 'Resultado %', key: 'pnl_pct', numeric: true },
]

const ALL_COLUMNS: Column<AllSortKey>[] = [
  { label: 'Fecha', key: 'date', numeric: false },
  { label: 'Activo', key: 'ticker', numeric: false },
  { label: 'Operación', key: 'operation', numeric: false },
  { label: 'Cantidad', key: 'quantity', numeric: true },
  { label: 'Precio', key: 'price', numeric: true },
  { label: 'Comisión', key: 'commission', numeric: true },
  { label: 'Cargada', key: 'created_at', numeric: false },
]

const OPERATION_LABELS: Record<string, string> = { COMPRA: 'Compra', VENTA: 'Venta', DIVIDENDO: 'Dividendo' }

const symbolOf = (ticker: string) => ticker.split(':')[1] ?? ticker
const marketOf = (ticker: string) => (ticker.includes(':') ? ticker.split(':')[0] : null)
const signColor = (n: number) => (n > 0 ? 'text-ok' : n < 0 ? 'text-danger' : '')
/** Quantities keep their own decimals (up to 6), like the old view. */
const qty = (n: number, sign = false) => formatNumber(n, { decimals: Math.min(6, (String(n).split('.')[1] ?? '').length), sign })
const shortDay = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

function sortRows<T, K extends string>(rows: T[], sort: Sort<K>, textKeys: K[], dateKeys: K[], textOf: (row: T, key: K) => string) {
  return [...rows].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    if (textKeys.includes(sort.key)) {
      const va = textOf(a, sort.key), vb = textOf(b, sort.key)
      return sort.dir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1)
    }
    const read = (row: T) => {
      const v = (row as Record<string, unknown>)[sort.key]
      return dateKeys.includes(sort.key) ? new Date(v as string).getTime() : ((v as number) ?? 0)
    }
    return (read(a) - read(b)) * dir
  })
}

function nextSort<K>(s: Sort<K>, key: K): Sort<K> {
  return s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }
}

function SortHead<K extends string>({ col, sort, onSort }: { col: Column<K>; sort: Sort<K>; onSort: (k: K) => void }) {
  const active = sort.key === col.key
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`whitespace-nowrap py-2 pr-3 font-medium ${col.numeric ? 'text-right' : 'text-left'}`}
    >
      <button type="button" onClick={() => onSort(col.key)} className={`inline-flex min-h-8 items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}>
        {col.label}
        {active && <span aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  )
}

function Skeleton() {
  return (
    <div role="status" aria-label="Cargando operaciones" className="grid gap-2 pt-3">
      {[0, 1, 2, 3, 4].map(i => <span key={i} className="block h-12 animate-pulse rounded bg-surface-2" />)}
    </div>
  )
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
      No se pudieron cargar las operaciones.
      <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2 max-[819px]:min-h-11">Reintentar</button>
    </div>
  )
}

/** A trade whose record is uncertain: the chip, why, and the way to fix it when there is one. */
function ReviewNote({ note, onFix }: { note: string | null | undefined; onFix?: () => void }) {
  return (
    <>
      <span className="ml-1.5 inline-flex items-center rounded bg-warn-soft px-1.5 py-0.5 align-middle text-xs font-medium text-warn">Revisar</span>
      <span className="mt-0.5 block max-w-[52ch] whitespace-normal text-[13px] font-normal text-ink-3">
        {note}
        {onFix && <>{' '}<button type="button" onClick={onFix} className="inline-flex min-h-8 items-center font-medium text-accent-ink hover:underline">Corregir</button></>}
      </span>
    </>
  )
}

/** A row dated before stored splits: what it is in today's shares (split-aware-ledger S5). */
function AfterSplitsNote({ t }: { t: Transaction }) {
  if (!t.after_splits) return null
  return <span className="mt-0.5 block max-w-[52ch] whitespace-normal text-[13px] font-normal text-ink-3">{afterSplitsText(t.after_splits)}</span>
}

const field = 'min-h-9 w-64 rounded-md border border-line-strong bg-surface px-3 text-ink placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_28%,transparent)] focus-visible:outline-none max-[819px]:min-h-11 max-[819px]:w-full'
// Tables need the width; below this the same rows read as a list.
const TABLE_ONLY = 'max-[1079px]:hidden'
const LIST_ONLY = 'min-[1080px]:hidden'

const DELETE_QUESTION = '¿Estás seguro que querés borrar esta operación? Esto recalculará toda la posición desde cero.'

async function fetchRows<T>(url: string): Promise<T[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(String(res.status))
  const data = await res.json()
  return data.data ?? []
}
const fetchClosed = () => fetchRows<ClosedTrade>('/api/transactions/closed')
const fetchAll = () => fetchRows<Transaction>('/api/transactions?limit=1000')

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<'closed' | 'all'>('closed')

  const [closedFilter, setClosedFilter] = useState('')
  const [closedSort, setClosedSort] = useState<Sort<ClosedSortKey>>({ key: 'close_date', dir: 'desc' })

  const [allFilter, setAllFilter] = useState('')
  const [allSort, setAllSort] = useState<Sort<AllSortKey>>({ key: 'date', dir: 'desc' })
  const [reviewOnly, setReviewOnly] = useState(false)
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Each tab keeps what it loaded: coming back shows it at once and refreshes it behind.
  const closed = useCached(activeTab === 'closed' ? 'history:closed' : null, fetchClosed)
  const all = useCached(activeTab === 'all' ? 'history:all' : null, fetchAll)
  // A retry shows the skeleton again until its answer, like the first load.
  const [retried, setRetried] = useState<unknown>(null)
  const closedError = !closed.data && !!closed.error && closed.error !== retried
  const closedLoading = !closed.data && !closedError
  const allError = !all.data && !!all.error && all.error !== retried
  const allLoading = !all.data && !allError
  const closedTrades = closed.data ?? []
  const allTx = all.data ?? []
  const retryClosed = () => { setRetried(closed.error); closed.reload() }
  const retryAll = () => { setRetried(all.error); all.reload() }

  async function handleFixed() {
    setFixingId(null)
    toast.success('Corrección guardada')
    all.reload()
    window.dispatchEvent(new CustomEvent('portfolio-needs-refresh'))
  }
  // Only a trade with a CEDEAR ratio can be re-derived from a broker ticket.
  const fixOf = (t: Transaction) => (t.cedear_ratio ? () => setFixingId(id => (id === t.id ? null : t.id)) : undefined)

  async function handleDelete(t: Transaction) {
    setDeletingId(t.id)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/transactions/${t.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'No se pudo borrar la operación.')
      }
      toast.success('Operación borrada')
      // The row leaves at once; the list is asked again behind, as the server recalculated the position.
      all.mutate(allTx.filter(x => x.id !== t.id))
      all.reload()
      setTimeout(() => {
        if (window.location.pathname === '/history') window.dispatchEvent(new CustomEvent('portfolio-needs-refresh'))
      }, 500)
    } catch (err) {
      setDeleteError(requestErrorMessage(err, 'No se pudo borrar la operación.'))
    } finally {
      setDeletingId(null)
    }
  }

  const closedSorted = sortRows(
    closedTrades.filter(t => !closedFilter || t.ticker.toLowerCase().includes(closedFilter.toLowerCase())),
    closedSort, ['ticker'], ['open_date', 'close_date'], t => symbolOf(t.ticker).toLowerCase(),
  )
  const allSorted = sortRows(
    allTx.filter(t => (!allFilter || t.ticker.toLowerCase().includes(allFilter.toLowerCase())) && (!reviewOnly || t.needs_review)),
    allSort, ['ticker', 'operation'], ['date', 'created_at'], (t, k) => String(t[k as 'ticker' | 'operation'] ?? '').toLowerCase(),
  )

  const reviewCount = allTx.filter(t => t.needs_review).length
  const totalPnl = closedTrades.reduce((s, t) => s + t.pnl, 0)
  const totalInvested = closedTrades.reduce((s, t) => s + t.invested, 0)
  const winRate = closedTrades.length > 0 ? closedTrades.filter(t => t.pnl > 0).length / closedTrades.length : 0

  const filter = activeTab === 'closed' ? closedFilter : allFilter
  const setFilter = activeTab === 'closed' ? setClosedFilter : setAllFilter

  return (
    <div className="mx-auto w-full max-w-[1240px] px-10 pb-16 pt-8 max-[819px]:px-4 max-[819px]:pb-24 max-[819px]:pt-5">
      <div className="mb-6">
        <h1 className="font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl">Operaciones</h1>
        <p className="mt-1 text-ink-3">Tus posiciones cerradas y todas las compras, ventas y dividendos que cargaste.</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <fieldset className="inline-flex gap-0.5 rounded-md border border-line bg-surface-2 p-0.5 max-[819px]:w-full">
          <legend className="sr-only">Vista</legend>
          {([['closed', 'Posiciones cerradas'], ['all', 'Todas las operaciones']] as const).map(([id, label]) => (
            <label
              key={id}
              className="relative inline-flex min-h-8 cursor-pointer items-center justify-center rounded px-3 text-[13px] text-ink-2 has-[:checked]:bg-surface has-[:checked]:font-medium has-[:checked]:text-ink has-[:checked]:shadow-[0_0_0_1px_var(--line)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring max-[819px]:min-h-11 max-[819px]:flex-1"
            >
              <input type="radio" name="history-view" value={id} checked={activeTab === id} onChange={() => setActiveTab(id)} className="absolute inset-0 m-0 cursor-pointer opacity-0" />
              {label}
            </label>
          ))}
        </fieldset>
        {activeTab === 'all' && reviewCount > 0 && (
          <button
            type="button"
            aria-pressed={reviewOnly}
            onClick={() => setReviewOnly(v => !v)}
            className="inline-flex min-h-9 items-center rounded-md border border-line-strong px-3 text-[13px] font-medium text-ink-2 hover:bg-hover aria-pressed:border-warn aria-pressed:bg-warn-soft aria-pressed:text-warn max-[819px]:min-h-11"
          >
            Para revisar ({reviewCount})
          </button>
        )}
        <div className="grid gap-1.5 max-[819px]:w-full">
          <label htmlFor="history-filter" className="text-[13px] font-medium">Filtrar por activo</label>
          <input id="history-filter" type="search" placeholder="Ticker" value={filter} onChange={e => setFilter(e.target.value)} className={field} />
        </div>
      </div>

      {deleteError && <p role="alert" className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{deleteError}</p>}

      {activeTab === 'closed' && (
        <section aria-labelledby="h-closed">
          <h2 id="h-closed" className="sr-only">Posiciones cerradas</h2>
          {closedLoading ? <Skeleton /> : closedError ? <LoadError onRetry={retryClosed} /> : (
            <>
              <dl className="grid grid-cols-4 gap-4 border-b border-line py-5 max-[819px]:grid-cols-2">
                <div>
                  <dt className="text-[13px] text-ink-3">Resultado realizado</dt>
                  <dd className={`text-base font-medium tabular-nums ${signColor(totalPnl)}`}>{totalPnl > 0 ? '+' : ''}{formatUSD(totalPnl)}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ink-3">Capital rotado</dt>
                  <dd className="text-base font-medium tabular-nums">{formatUSD(totalInvested)}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ink-3">Cerradas con ganancia</dt>
                  <dd className="text-base font-medium tabular-nums">{formatPct(winRate, { digits: 1, sign: false })}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ink-3">Posiciones cerradas</dt>
                  <dd className="text-base font-medium tabular-nums">{closedTrades.length}</dd>
                </div>
              </dl>

              {closedSorted.length === 0 ? (
                <p className="py-6 text-[13px] text-ink-3">{closedFilter ? 'Ninguna posición cerrada coincide con el filtro.' : 'Todavía no cerraste ninguna posición.'}</p>
              ) : (
                <>
                  <div className={`overflow-x-auto pt-3 ${TABLE_ONLY}`}>
                    <table className="w-full border-collapse text-sm tabular-nums">
                      <caption className="sr-only">Posiciones cerradas, importes en dólares. Ordená con los botones del encabezado.</caption>
                      <thead>
                        <tr className="border-b border-line-strong text-[13px] text-ink-3">
                          {CLOSED_COLUMNS.map(c => <SortHead key={c.key} col={c} sort={closedSort} onSort={k => setClosedSort(s => nextSort(s, k))} />)}
                        </tr>
                      </thead>
                      <tbody>
                        {closedSorted.map(t => (
                          <tr key={t.id} className="border-b border-line last:border-b-0 hover:bg-hover">
                            <th scope="row" className="whitespace-nowrap py-2.5 pr-3 text-left font-normal">
                              <span className="font-semibold">{symbolOf(t.ticker)}</span>
                              {marketOf(t.ticker) && <span className="ml-1.5 text-[13px] text-ink-3">{marketOf(t.ticker)}</span>}
                            </th>
                            <td className="whitespace-nowrap py-2.5 pr-3 text-ink-2">{formatDate(t.open_date)}</td>
                            <td className="whitespace-nowrap py-2.5 pr-3 text-ink-2">{formatDate(t.close_date)}</td>
                            <td className="py-2.5 pr-3 text-right">{t.days_held}</td>
                            <td className="py-2.5 pr-3 text-right">{formatNumber(t.avg_cost)}</td>
                            <td className="py-2.5 pr-3 text-right">{formatNumber(t.close_price)}</td>
                            <td className="py-2.5 pr-3 text-right">{qty(t.quantity)}</td>
                            <td className="py-2.5 pr-3 text-right">{formatNumber(t.invested)}</td>
                            <td className="py-2.5 pr-3 text-right">{formatNumber(t.proceeds)}</td>
                            <td className={`py-2.5 pr-3 text-right font-medium ${signColor(t.pnl)}`}>{formatNumber(t.pnl, { sign: true })}</td>
                            <td className={`py-2.5 text-right ${signColor(t.pnl)}`}>{formatPct(t.pnl_pct, { digits: 1 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <ul className={LIST_ONLY}>
                    {closedSorted.map(t => (
                      <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line py-3 last:border-b-0">
                        <span className="min-w-0">
                          <span className="font-semibold">{symbolOf(t.ticker)}</span>
                          {marketOf(t.ticker) && <span className="ml-1.5 text-[13px] text-ink-3">{marketOf(t.ticker)}</span>}
                          <span className="block text-[13px] text-ink-3">
                            {formatDate(t.open_date)} al {formatDate(t.close_date)}, {t.days_held} {t.days_held === 1 ? 'día' : 'días'}
                          </span>
                          <span className="block text-[13px] text-ink-3 tabular-nums">Invertido {formatNumber(t.invested)}, retorno {formatNumber(t.proceeds)}</span>
                        </span>
                        <span className={`text-right tabular-nums ${signColor(t.pnl)}`}>
                          <b className="block font-medium">{formatNumber(t.pnl, { sign: true })}</b>
                          <small className="text-[13px]">{formatPct(t.pnl_pct, { digits: 1 })}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      )}

      {activeTab === 'all' && (
        <section aria-labelledby="h-all">
          <h2 id="h-all" className="sr-only">Todas las operaciones</h2>
          {allLoading ? <Skeleton /> : allError ? <LoadError onRetry={retryAll} /> : allSorted.length === 0 ? (
            <p className="py-6 text-[13px] text-ink-3">{allFilter || reviewOnly ? 'Ninguna operación coincide con el filtro.' : 'Todavía no cargaste operaciones.'}</p>
          ) : (
            <>
              <div className={`overflow-x-auto pt-3 ${TABLE_ONLY}`}>
                <table className="w-full border-collapse text-sm tabular-nums">
                  <caption className="sr-only">Todas las operaciones, importes en dólares. Ordená con los botones del encabezado.</caption>
                  <thead>
                    <tr className="border-b border-line-strong text-[13px] text-ink-3">
                      {ALL_COLUMNS.map(c => <SortHead key={c.key} col={c} sort={allSort} onSort={k => setAllSort(s => nextSort(s, k))} />)}
                      <th scope="col" className="py-2"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {allSorted.map(t => (
                      <Fragment key={t.id}>
                      <tr className="border-b border-line last:border-b-0 hover:bg-hover">
                        <td className="whitespace-nowrap py-2 pr-3 align-top text-ink-2">{formatDate(t.date)}</td>
                        <th scope="row" className="py-2 pr-3 text-left font-semibold">
                          {symbolOf(t.ticker)}
                          {t.needs_review && <ReviewNote note={t.review_note} onFix={fixOf(t)} />}
                          <AfterSplitsNote t={t} />
                        </th>
                        <td className="py-2 pr-3">{OPERATION_LABELS[t.operation] ?? t.operation}</td>
                        <td className="py-2 pr-3 text-right">{qty(t.quantity, true)}</td>
                        <td className="py-2 pr-3 text-right">{formatNumber(t.price)}</td>
                        <td className="py-2 pr-3 text-right text-ink-2">{t.commission ? formatNumber(t.commission) : '—'}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-ink-3">{new Date(t.created_at).toLocaleDateString('es-AR')}</td>
                        <td className="py-2 text-right">
                          <InlineConfirm
                            question={DELETE_QUESTION}
                            confirmLabel="Sí, borrar"
                            onConfirm={() => void handleDelete(t)}
                            busy={deletingId === t.id}
                            triggerLabel={`Borrar operación de ${symbolOf(t.ticker)} del ${formatDate(t.date)}`}
                            triggerClassName="grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-danger disabled:opacity-50"
                            className="max-w-sm justify-end text-left"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                          </InlineConfirm>
                        </td>
                      </tr>
                      {fixingId === t.id && (
                        <tr className="border-b border-line">
                          <td colSpan={ALL_COLUMNS.length + 1} className="py-3">
                            <ReviewFix tx={t} view="table" onSaved={handleFixed} onCancel={() => setFixingId(null)} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className={LIST_ONLY}>
                {allSorted.map(t => (
                  <Fragment key={t.id}>
                  <li className="grid min-h-[52px] grid-cols-[56px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line py-2 last:border-b-0 max-[819px]:grid-cols-[48px_minmax(0,1fr)_auto_auto]">
                    <time dateTime={t.date} className="text-[13px] font-medium tabular-nums">
                      {shortDay(t.date)}<small className="block text-xs font-normal text-ink-3">{t.date.slice(0, 4)}</small>
                    </time>
                    <span className="min-w-0">
                      <span className="block font-semibold">{symbolOf(t.ticker)}{t.needs_review && <ReviewNote note={t.review_note} onFix={fixOf(t)} />}</span>
                      <span className="block truncate text-[13px] text-ink-3 tabular-nums">{OPERATION_LABELS[t.operation] ?? t.operation} a {formatNumber(t.price)}</span>
                      <AfterSplitsNote t={t} />
                    </span>
                    <span className="font-medium tabular-nums">{qty(t.quantity, true)}</span>
                    <InlineConfirm
                      question={DELETE_QUESTION}
                      confirmLabel="Sí, borrar"
                      onConfirm={() => void handleDelete(t)}
                      busy={deletingId === t.id}
                      triggerLabel={`Borrar operación de ${symbolOf(t.ticker)} del ${formatDate(t.date)}`}
                      triggerClassName="grid h-11 w-11 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-danger disabled:opacity-50"
                      className="col-span-full justify-end"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                    </InlineConfirm>
                  </li>
                  {fixingId === t.id && (
                    <li className="border-b border-line py-3">
                      <ReviewFix tx={t} view="list" onSaved={handleFixed} onCancel={() => setFixingId(null)} />
                    </li>
                  )}
                  </Fragment>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  )
}
