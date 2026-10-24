'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getSetupColor } from '@/lib/setup-color'
import { Chip } from '@/components/resumen/ui'
import { ErrorNotice, Segmented, SkeletonRows, field, page, pageTitle, tabClass, textLink } from '@/components/strategies/ui'
import { cn, formatNumber } from '@/lib/utils'
import { useCached } from '@/lib/client-cache'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SetupPerformance {
  setup_id: string
  setup_name: string
  active: boolean
  total_trades: number
  profitable_trades: number
  hit_rate: number | null
  avg_return_pct: number | null
  avg_duration_days: number | null
  open_trades: number
  tickers: string[]
}

interface PerformanceResponse {
  setups: SetupPerformance[]
  best_setup_id: string | null
  /** What the page shows of the strategy: it comes with its performance (odd/tasks/rendimiento.md S9). */
  strategy?: { id: string; name: string; tickers: string[]; setups: Array<{ id: string; name: string; active: boolean }> }
}

interface Signal {
  id: string
  setup_id: string
  setup_name: string
  ticker: string
  type: 'BUY' | 'SELL'
  price: number
  timeframe: string
  fired_at: string
  metadata: Record<string, unknown> | null
}

interface SignalsResponse {
  signals: Signal[]
}

interface PaperTrade {
  id: string
  setup_id: string
  setup_name: string
  ticker: string
  status: 'OPEN' | 'CLOSED'
  open_price: number
  close_price: number | null
  open_at: string
  close_at: string | null
  close_reason: 'SIGNAL' | 'STOP_LOSS' | 'TAKE_PROFIT' | null
  pnl_pct: number | null
}

interface PaperTradesResponse {
  trades: PaperTrade[]
}

// ─── Date formatting ──────────────────────────────────────────────────────────

function formatDateHeading(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (isSameDay(date, today)) return 'Hoy'
  if (isSameDay(date, yesterday)) return 'Ayer'

  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = date.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${min} h`
}

function getDayKey(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const signColor = (n: number | null) => (n === null ? 'text-ink-3' : n > 0 ? 'text-ok' : n < 0 ? 'text-danger' : '')
const money = (n: number) => `US$ ${formatNumber(n)}`
const day = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const days = (n: number | null) => (n === null ? <span className="text-ink-3">—</span> : `${n.toFixed(0)} días`)
const th = 'py-2 pr-4 font-medium last:pr-0'
const td = 'py-2.5 pr-4 last:pr-0'
// Below 1080 px (phones and tablets, where the menu takes room) the wide tables become cards.
const card = 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-line py-3 last:border-b-0'

/** Percent value in points (12.5 = 12,5 %), with sign; dash when missing. */
function Pct({ value, digits = 1, sign = true }: { value: number | null; digits?: number; sign?: boolean }) {
  if (value === null) return <span className="text-ink-3">—</span>
  return <span className={sign ? signColor(value) : ''}>{formatNumber(value, { decimals: digits, sign })} %</span>
}

function SetupName({ id, name }: { id: string; name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: getSetupColor(id) }} aria-hidden="true" />
      <span className="min-w-0 break-words">{name}</span>
    </span>
  )
}

function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-6">
      <p className="text-ink-2">{title}</p>
      {hint && <p className="mt-1 text-[13px] text-ink-3">{hint}</p>}
    </div>
  )
}

// ─── Tab: Comparison ─────────────────────────────────────────────────────────

function ComparisonTab({
  setups,
  bestSetupId,
}: {
  setups: SetupPerformance[]
  bestSetupId: string | null
}) {
  const allEmpty = setups.every((s) => s.total_trades === 0)

  if (allEmpty) {
    return <Empty title="Todavía no hay datos de paper trading." hint="El motor de señales los genera automáticamente tres veces por día." />
  }

  return (
    <>
      <div className="overflow-x-auto max-[1279px]:hidden">
        <table className="w-full min-w-[820px] border-collapse text-sm tabular-nums">
          <caption className="sr-only">Comparación de setups</caption>
          <thead>
            <tr className="border-b border-line-strong text-left text-[13px] text-ink-3">
              <th scope="col" className={th}>Setup</th>
              <th scope="col" className={th}>Estado</th>
              <th scope="col" className={`${th} text-right`}>Operaciones</th>
              <th scope="col" className={`${th} text-right`}>Ganadoras</th>
              <th scope="col" className={`${th} text-right`}>Acierto</th>
              <th scope="col" className={`${th} text-right`}>Retorno prom.</th>
              <th scope="col" className={`${th} text-right`}>Duración prom.</th>
              <th scope="col" className={`${th} text-right`}>Abiertas</th>
            </tr>
          </thead>
          <tbody>
            {setups.map((setup) => (
              <tr key={setup.setup_id} className="border-b border-line last:border-b-0 hover:bg-hover">
                <th scope="row" className={`${td} text-left font-medium`}>
                  <span className="flex flex-wrap items-center gap-2">
                    <SetupName id={setup.setup_id} name={setup.setup_name} />
                    {setup.setup_id === bestSetupId && <Chip tone="ok">Mejor</Chip>}
                  </span>
                </th>
                <td className={td}><Chip tone={setup.active ? 'ok' : 'neutral'}>{setup.active ? 'Activo' : 'Inactivo'}</Chip></td>
                <td className={`${td} text-right`}>{setup.total_trades}</td>
                <td className={`${td} text-right`}>{setup.profitable_trades}</td>
                <td className={`${td} text-right`}><Pct value={setup.hit_rate === null ? null : setup.hit_rate * 100} sign={false} /></td>
                <td className={`${td} text-right`}><Pct value={setup.avg_return_pct} /></td>
                <td className={`${td} text-right`}>{days(setup.avg_duration_days)}</td>
                <td className={`${td} text-right`}>{setup.open_trades}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label="Comparación de setups" className="border-t border-line-strong min-[1280px]:hidden">
        {setups.map((setup) => (
          <li key={setup.setup_id} className={card}>
            <span className="flex min-w-0 flex-wrap items-center gap-2 font-medium">
              <SetupName id={setup.setup_id} name={setup.setup_name} />
              {setup.setup_id === bestSetupId && <Chip tone="ok">Mejor</Chip>}
              <Chip tone={setup.active ? 'ok' : 'neutral'}>{setup.active ? 'Activo' : 'Inactivo'}</Chip>
            </span>
            <span className="text-right tabular-nums">
              <span className="block text-base font-medium"><Pct value={setup.avg_return_pct} /></span>
              <small className="block text-[13px] text-ink-3">Retorno prom.</small>
            </span>
            <p className="col-span-2 mt-1.5 text-[13px] tabular-nums text-ink-2">
              Acierto <Pct value={setup.hit_rate === null ? null : setup.hit_rate * 100} sign={false} /> · Operaciones {setup.total_trades}
            </p>
            <p className="col-span-2 text-[13px] tabular-nums text-ink-3">
              Ganadoras {setup.profitable_trades} · Duración prom. {days(setup.avg_duration_days)} · Abiertas {setup.open_trades}
            </p>
          </li>
        ))}
      </ul>
    </>
  )
}

// ─── Tab: Signals ─────────────────────────────────────────────────────────────

function SignalsTab({ signals, loading, error, onRetry }: { signals: Signal[]; loading: boolean; error: boolean; onRetry: () => void }) {
  if (loading) return <SkeletonRows label="Cargando señales" rows={3} />

  if (error) return <ErrorNotice onRetry={onRetry}>No se pudieron cargar las señales.</ErrorNotice>

  if (signals.length === 0) return <Empty title="No hay señales para los filtros elegidos." />

  // Group by day
  const groups = new Map<string, { heading: string; signals: Signal[] }>()
  for (const signal of signals) {
    const key = getDayKey(signal.fired_at)
    if (!groups.has(key)) {
      groups.set(key, { heading: formatDateHeading(signal.fired_at), signals: [] })
    }
    groups.get(key)!.signals.push(signal)
  }

  return (
    <div className="grid gap-6">
      {Array.from(groups.entries()).map(([key, group]) => (
        <section key={key} aria-label={group.heading}>
          <h3 className="border-b border-line pb-2 text-[13px] font-medium text-ink-2">{group.heading}</h3>
          <ul>
            {group.signals.map((signal) => <SignalRow key={signal.id} signal={signal} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}

function SignalRow({ signal }: { signal: Signal }) {
  const isBuy = signal.type === 'BUY'
  const metaEntries = signal.metadata ? Object.entries(signal.metadata) : []

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line py-2.5 last:border-b-0">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium"><SetupName id={signal.setup_id} name={signal.setup_name} /></span>
          <Chip tone={isBuy ? 'ok' : 'danger'}>{isBuy ? 'Compra' : 'Venta'}</Chip>
          <span className="font-semibold">{signal.ticker}</span>
        </span>
        {metaEntries.length > 0 && (
          <small className="mt-0.5 block break-words text-[13px] text-ink-3">
            {metaEntries.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
          </small>
        )}
      </span>
      <span className="text-right tabular-nums">
        <span className="block font-medium">{money(signal.price)}</span>
        <small className="block text-[13px] text-ink-3">{signal.timeframe} · {formatTime(signal.fired_at)}</small>
      </span>
    </li>
  )
}

// ─── Tab: Paper Trades ───────────────────────────────────────────────────────

const CLOSE_REASONS: Record<string, { label: string; tone: 'ok' | 'danger' | 'neutral' }> = {
  SIGNAL: { label: 'Señal', tone: 'neutral' },
  STOP_LOSS: { label: 'Stop loss', tone: 'danger' },
  TAKE_PROFIT: { label: 'Take profit', tone: 'ok' },
}

function CloseReasonBadge({ value }: { value: 'SIGNAL' | 'STOP_LOSS' | 'TAKE_PROFIT' | null }) {
  if (!value) return <span className="text-ink-3">—</span>
  const { label, tone } = CLOSE_REASONS[value] ?? { label: value, tone: 'neutral' as const }
  return <Chip tone={tone}>{label}</Chip>
}

function PaperTradesTab({
  trades,
  loading,
  error,
  onRetry,
  setups,
}: {
  trades: PaperTrade[]
  loading: boolean
  error: boolean
  onRetry: () => void
  setups: Array<{ id: string; name: string; active: boolean }>
}) {
  const [setupFilter, setSetupFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'OPEN' | 'CLOSED'>('all')

  if (loading) return <SkeletonRows label="Cargando paper trades" rows={3} />

  if (error) return <div className="pt-3"><ErrorNotice onRetry={onRetry}>No se pudieron cargar los paper trades.</ErrorNotice></div>

  const filtered = trades.filter((t) => {
    if (setupFilter !== 'all' && t.setup_id !== setupFilter) return false
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    return true
  })

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-4">
        {setups.length > 0 && (
          <div className="grid gap-1">
            <label htmlFor="trades-setup" className="text-[13px] text-ink-2">Setup</label>
            <select id="trades-setup" value={setupFilter} onChange={(e) => setSetupFilter(e.target.value)} className={cn(field, 'w-auto min-w-40 max-w-full')}>
              <option value="all">Todos</option>
              {setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div className="grid gap-1">
          <span className="text-[13px] text-ink-2" aria-hidden="true">Estado</span>
          <Segmented
            name="trades-status"
            legend="Estado"
            options={[
              { label: 'Todos', value: 'all' as const },
              { label: 'Abiertos', value: 'OPEN' as const },
              { label: 'Cerrados', value: 'CLOSED' as const },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty title="No hay paper trades para los filtros elegidos." hint="Se generan automáticamente cuando las señales abren y cierran posiciones." />
      ) : (
        <>
          <div className="overflow-x-auto max-[1279px]:hidden">
            <table className="w-full min-w-[920px] border-collapse text-sm tabular-nums">
              <caption className="sr-only">Paper trades</caption>
              <thead>
                <tr className="border-b border-line-strong text-left text-[13px] text-ink-3">
                  <th scope="col" className={th}>Setup</th>
                  <th scope="col" className={th}>Ticker</th>
                  <th scope="col" className={th}>Estado</th>
                  <th scope="col" className={`${th} text-right`}>Apertura</th>
                  <th scope="col" className={`${th} text-right`}>Cierre</th>
                  <th scope="col" className={`${th} text-right`}>Precio de entrada</th>
                  <th scope="col" className={`${th} text-right`}>Precio de salida</th>
                  <th scope="col" className={`${th} text-right`}>Resultado</th>
                  <th scope="col" className={`${th} text-right`}>Motivo de cierre</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((trade) => (
                  <tr key={trade.id} className="border-b border-line last:border-b-0 hover:bg-hover">
                    <th scope="row" className={`${td} text-left font-medium`}><SetupName id={trade.setup_id} name={trade.setup_name} /></th>
                    <td className={`${td} font-semibold`}>{trade.ticker}</td>
                    <td className={td}><Chip tone={trade.status === 'OPEN' ? 'ok' : 'neutral'}>{trade.status === 'OPEN' ? 'Abierto' : 'Cerrado'}</Chip></td>
                    <td className={`${td} text-right`}>{day(trade.open_at)}</td>
                    <td className={`${td} text-right`}>{trade.close_at ? day(trade.close_at) : <span className="text-ink-3">—</span>}</td>
                    <td className={`${td} text-right`}>{money(trade.open_price)}</td>
                    <td className={`${td} text-right`}>{trade.close_price !== null ? money(trade.close_price) : <span className="text-ink-3">—</span>}</td>
                    <td className={`${td} text-right font-medium`}><Pct value={trade.pnl_pct} digits={2} /></td>
                    <td className={`${td} text-right`}><CloseReasonBadge value={trade.close_reason} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul aria-label="Paper trades" className="border-t border-line-strong min-[1280px]:hidden">
            {filtered.map((trade) => (
              <li key={trade.id} className={card}>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold">{trade.ticker}</span>
                    <Chip tone={trade.status === 'OPEN' ? 'ok' : 'neutral'}>{trade.status === 'OPEN' ? 'Abierto' : 'Cerrado'}</Chip>
                  </span>
                  <small className="mt-0.5 block text-[13px] text-ink-2"><SetupName id={trade.setup_id} name={trade.setup_name} /></small>
                </span>
                <span className="grid justify-items-end gap-1 tabular-nums">
                  <span className="text-base font-medium"><span className="sr-only">Resultado </span><Pct value={trade.pnl_pct} digits={2} /></span>
                  {trade.close_reason && <CloseReasonBadge value={trade.close_reason} />}
                </span>
                <p className="col-span-2 mt-1.5 text-[13px] tabular-nums text-ink-2">
                  Entrada {money(trade.open_price)}
                  {trade.close_price !== null && <> · Salida {money(trade.close_price)}</>}
                </p>
                <p className="col-span-2 text-[13px] tabular-nums text-ink-3">
                  Apertura {day(trade.open_at)}
                  {trade.close_at && <> · Cierre {day(trade.close_at)}</>}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d' | '1y'
type SignalType = 'all' | 'BUY' | 'SELL'
type Tab = 'comparison' | 'signals' | 'paper-trades'

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: '7 días', value: '7d' },
  { label: '30 días', value: '30d' },
  { label: '90 días', value: '90d' },
  { label: '1 año', value: '1y' },
]

const TYPE_OPTIONS: { label: string; value: SignalType }[] = [
  { label: 'Todas', value: 'all' },
  { label: 'Compra', value: 'BUY' },
  { label: 'Venta', value: 'SELL' },
]

const TABS: { id: Tab; label: string }[] = [
  { id: 'comparison', label: 'Comparación' },
  { id: 'signals', label: 'Señales' },
  { id: 'paper-trades', label: 'Paper trades' },
]

/** One GET whose failure is thrown, so the client cache never remembers it. */
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

export default function PerformancePage() {
  const params = useParams<{ id: string }>()
  const strategyId = params.id

  const [activeTab, setActiveTab] = useState<Tab>('comparison')
  const [period, setPeriod] = useState<Period>('30d')
  const [ticker, setTicker] = useState<string>('all')
  const [signalType, setSignalType] = useState<SignalType>('all')
  // Paper trades load the first time their tab opens, and stay (odd/tasks/rendimiento.md S9).
  const [tradesWanted, setTradesWanted] = useState(false)

  // Seen before in this tab, each part shows at once and refreshes behind (S9).
  const base = `/api/strategies/${strategyId}`
  const performanceQuery = useCached(`strategies:${strategyId}:performance`, () => getJson<PerformanceResponse>(`${base}/performance`))
  const signalParams = new URLSearchParams({ period })
  if (ticker !== 'all') signalParams.set('ticker', ticker)
  if (signalType !== 'all') signalParams.set('type', signalType)
  const signalsQuery = useCached(`strategies:${strategyId}:signals:${signalParams}`, () => getJson<SignalsResponse>(`${base}/signals?${signalParams}`))
  // Both states in parallel: one round trip, not two in a row.
  const tradesQuery = useCached(tradesWanted ? `strategies:${strategyId}:paper-trades` : null, async () => {
    const [open, closed] = await Promise.all([
      getJson<PaperTradesResponse>(`${base}/paper-trades?status=OPEN`),
      getJson<PaperTradesResponse>(`${base}/paper-trades?status=CLOSED`),
    ])
    return [...open.trades, ...closed.trades]
  })

  const performance = performanceQuery.data ?? null
  const strategy = performance?.strategy ?? null
  const isLoading = !performance && performanceQuery.loading

  function selectTab(tab: Tab) {
    setActiveTab(tab)
    if (tab === 'paper-trades') setTradesWanted(true)
  }

  // Arrow keys move between tabs, as the tab pattern expects.
  function onTabKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = TABS.findIndex((t) => t.id === activeTab)
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    selectTab(next.id)
    document.getElementById(`tab-${next.id}`)?.focus()
  }

  return (
    <div className={page}>
      <Link href={`/strategies/${strategyId}`} className={`${textLink} mb-2`}>
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        {strategy?.name ?? 'Estrategia'}
      </Link>
      <div className="mb-6">
        <h1 className={pageTitle}>Rendimiento de los setups</h1>
        <p className="mt-1 text-ink-3">Resultados de paper trading y señales que generó cada setup de la estrategia.</p>
      </div>

      {isLoading ? <SkeletonRows label="Cargando el rendimiento" /> : (
        <>
          <div role="tablist" aria-label="Vistas" onKeyDown={onTabKey} className="mb-6 flex gap-6 overflow-x-auto border-b border-line">
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={activeTab === t.id ? 0 : -1}
                onClick={() => selectTab(t.id)}
                className={`${tabClass(activeTab === t.id)} whitespace-nowrap`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
            {activeTab === 'comparison' && (
              performance
                ? <ComparisonTab setups={performance.setups} bestSetupId={performance.best_setup_id} />
                : <ErrorNotice onRetry={performanceQuery.reload}>No se pudo cargar la comparación.</ErrorNotice>
            )}

            {activeTab === 'signals' && (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-end gap-4">
                  {strategy && strategy.tickers.length > 0 && (
                    <div className="grid gap-1">
                      <label htmlFor="signals-ticker" className="text-[13px] text-ink-2">Ticker</label>
                      <select id="signals-ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} className={cn(field, 'w-auto min-w-32')}>
                        <option value="all">Todos</option>
                        {strategy.tickers.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="grid gap-1">
                    <span className="text-[13px] text-ink-2" aria-hidden="true">Tipo</span>
                    <Segmented name="signals-type" legend="Tipo de señal" options={TYPE_OPTIONS} value={signalType} onChange={setSignalType} />
                  </div>
                  <div className="grid gap-1">
                    <span className="text-[13px] text-ink-2" aria-hidden="true">Período</span>
                    <Segmented name="signals-period" legend="Período" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
                  </div>
                </div>
                <SignalsTab
                  signals={signalsQuery.data?.signals ?? []}
                  loading={!signalsQuery.data && signalsQuery.loading}
                  error={!signalsQuery.data && !!signalsQuery.error}
                  onRetry={signalsQuery.reload}
                />
              </div>
            )}

            {activeTab === 'paper-trades' && (
              <PaperTradesTab
                trades={tradesQuery.data ?? []}
                loading={!tradesQuery.data && tradesQuery.loading}
                error={!tradesQuery.data && !!tradesQuery.error}
                onRetry={tradesQuery.reload}
                setups={strategy?.setups ?? []}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
