'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getSetupColor } from '@/lib/setup-color'

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

interface Strategy {
  id: string
  name: string
  tickers: string[]
  timeframes: string[]
  active: boolean
  indicator_setups: Array<{ id: string; name: string; active: boolean }>
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
  return `${hh}:${min}hs`
}

function getDayKey(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HitRateCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-500">—</span>
  const pct = value * 100
  const color = pct >= 60 ? 'text-tv-green' : pct < 40 ? 'text-tv-red' : 'text-white'
  return <span className={color}>{pct.toFixed(1)}%</span>
}

function ReturnCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-500">—</span>
  const color = value >= 0 ? 'text-tv-green' : 'text-tv-red'
  const prefix = value >= 0 ? '+' : ''
  return <span className={color}>{prefix}{value.toFixed(1)}%</span>
}

function PillSelector<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
            value === opt.value
              ? 'bg-amber/20 text-amber border-amber/40'
              : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-white/20'
          }`}
        >
          {opt.label}
        </button>
      ))}
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
    return (
      <div className="glass rounded-2xl p-8 border border-white/[0.08] flex flex-col items-center gap-2 text-center">
        <p className="text-slate-300 font-display font-600 text-sm">Sin datos de paper trading todavía.</p>
        <p className="text-slate-500 font-mono text-xs">El motor de señales genera datos automáticamente 3 veces por día.</p>
      </div>
    )
  }

  return (
    <div className="glass rounded-2xl border border-white/[0.08] overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-slate-400 text-[11px] uppercase tracking-wider pb-2 text-left px-5 pt-4">Setup</th>
            <th className="text-slate-400 text-[11px] uppercase tracking-wider pb-2 text-left px-3 pt-4">Estado</th>
            <th className="text-slate-400 text-[11px] uppercase tracking-wider pb-2 text-right px-3 pt-4">P. Trades</th>
            <th className="text-slate-400 text-[11px] uppercase tracking-wider pb-2 text-right px-3 pt-4">Rentables</th>
            <th className="text-slate-400 text-[11px] uppercase tracking-wider pb-2 text-right px-3 pt-4">Hit Rate</th>
            <th className="text-slate-400 text-[11px] uppercase tracking-wider pb-2 text-right px-3 pt-4">Retorno Avg</th>
            <th className="text-slate-400 text-[11px] uppercase tracking-wider pb-2 text-right px-3 pt-4">Duración Avg</th>
            <th className="text-slate-400 text-[11px] uppercase tracking-wider pb-2 text-right px-5 pt-4">Abiertos</th>
          </tr>
        </thead>
        <tbody>
          {setups.map((setup) => (
            <tr key={setup.setup_id}>
              <td className="py-3 border-t border-white/[0.06] px-5">
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: getSetupColor(setup.setup_id) }}
                  />
                  <span className="text-white text-sm">{setup.setup_name}</span>
                  {setup.setup_id === bestSetupId && (
                    <span className="tag-positive text-[10px] shrink-0">★ Mejor</span>
                  )}
                </div>
              </td>
              <td className="py-3 border-t border-white/[0.06] px-3">
                <span className={setup.active ? 'tag-positive text-[10px]' : 'tag-neutral text-[10px]'}>
                  {setup.active ? 'Activo' : 'Inactivo'}
                </span>
              </td>
              <td className="py-3 border-t border-white/[0.06] px-3 text-right text-white font-mono">
                {setup.total_trades}
              </td>
              <td className="py-3 border-t border-white/[0.06] px-3 text-right text-white font-mono">
                {setup.profitable_trades}
              </td>
              <td className="py-3 border-t border-white/[0.06] px-3 text-right font-mono">
                <HitRateCell value={setup.hit_rate} />
              </td>
              <td className="py-3 border-t border-white/[0.06] px-3 text-right font-mono">
                <ReturnCell value={setup.avg_return_pct} />
              </td>
              <td className="py-3 border-t border-white/[0.06] px-3 text-right font-mono text-white">
                {setup.avg_duration_days !== null ? `${setup.avg_duration_days.toFixed(0)}d` : <span className="text-slate-500">—</span>}
              </td>
              <td className="py-3 border-t border-white/[0.06] px-5 text-right font-mono text-white">
                {setup.open_trades}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Tab: Signals ─────────────────────────────────────────────────────────────

function SignalsTab({ signals, loading }: { signals: Signal[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 rounded-full border-2 border-amber border-t-transparent animate-spin" />
      </div>
    )
  }

  if (signals.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 border border-white/[0.08] flex items-center justify-center">
        <p className="text-slate-500 font-mono text-sm">No hay señales para los filtros seleccionados.</p>
      </div>
    )
  }

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
    <div className="flex flex-col gap-6">
      {Array.from(groups.values()).map((group) => (
        <div key={group.heading}>
          <p className="text-slate-500 text-[11px] font-mono uppercase tracking-wider mb-3">{group.heading}</p>
          <div className="flex flex-col gap-2">
            {group.signals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SignalCard({ signal }: { signal: Signal }) {
  const color = getSetupColor(signal.setup_id)
  const isBuy = signal.type === 'BUY'
  const metaEntries = signal.metadata ? Object.entries(signal.metadata) : []

  return (
    <div className="glass rounded-xl p-4 border border-white/[0.08]">
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-white text-sm font-display font-600">{signal.setup_name}</span>
        <span
          className={`px-2 py-0.5 rounded-full text-[11px] font-mono border ${
            isBuy
              ? 'bg-tv-green/10 text-tv-green border-tv-green/30'
              : 'bg-tv-red/10 text-tv-red border-tv-red/30'
          }`}
        >
          {signal.type}
        </span>
        <span className="text-slate-300 text-sm font-mono">{signal.ticker}</span>
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className="text-white font-mono text-sm">${signal.price.toFixed(2)}</span>
        <span className="text-slate-500 text-[11px]">·</span>
        <span className="text-slate-400 text-[11px] font-mono">{signal.timeframe}</span>
        <span className="text-slate-500 text-[11px]">·</span>
        <span className="text-slate-400 text-[11px] font-mono">{formatTime(signal.fired_at)}</span>
      </div>

      {metaEntries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {metaEntries.map(([k, v]) => (
            <span
              key={k}
              className="text-slate-500 text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]"
            >
              {k}: {String(v)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d' | '1y'
type SignalType = 'all' | 'BUY' | 'SELL'
type Tab = 'comparison' | 'signals'

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: '1y', value: '1y' },
]

const TYPE_OPTIONS: { label: string; value: SignalType }[] = [
  { label: 'Todos', value: 'all' },
  { label: 'BUY', value: 'BUY' },
  { label: 'SELL', value: 'SELL' },
]

export default function PerformancePage() {
  const params = useParams<{ id: string }>()
  const strategyId = params.id

  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [performance, setPerformance] = useState<PerformanceResponse | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])

  const [loadingStrategy, setLoadingStrategy] = useState(true)
  const [loadingPerformance, setLoadingPerformance] = useState(true)
  const [loadingSignals, setLoadingSignals] = useState(true)

  const [activeTab, setActiveTab] = useState<Tab>('comparison')
  const [period, setPeriod] = useState<Period>('30d')
  const [ticker, setTicker] = useState<string>('all')
  const [signalType, setSignalType] = useState<SignalType>('all')

  const loadStrategy = useCallback(async () => {
    try {
      const res = await fetch(`/api/strategies/${strategyId}`)
      if (!res.ok) return
      const data = await res.json() as { strategy: Strategy }
      setStrategy(data.strategy)
    } finally {
      setLoadingStrategy(false)
    }
  }, [strategyId])

  const loadPerformance = useCallback(async () => {
    try {
      setLoadingPerformance(true)
      const res = await fetch(`/api/strategies/${strategyId}/performance`)
      if (!res.ok) return
      const data = await res.json() as PerformanceResponse
      setPerformance(data)
    } finally {
      setLoadingPerformance(false)
    }
  }, [strategyId])

  const loadSignals = useCallback(async () => {
    try {
      setLoadingSignals(true)
      const params = new URLSearchParams({ period })
      if (ticker !== 'all') params.set('ticker', ticker)
      if (signalType !== 'all') params.set('type', signalType)
      const res = await fetch(`/api/strategies/${strategyId}/signals?${params.toString()}`)
      if (!res.ok) return
      const data = await res.json() as SignalsResponse
      setSignals(data.signals)
    } finally {
      setLoadingSignals(false)
    }
  }, [strategyId, period, ticker, signalType])

  useEffect(() => { loadStrategy() }, [loadStrategy])
  useEffect(() => { loadPerformance() }, [loadPerformance])
  useEffect(() => { loadSignals() }, [loadSignals])

  const isLoading = loadingStrategy || loadingPerformance

  if (isLoading) {
    return (
      <div className="min-h-screen md:pl-56 pb-20 md:pb-0 p-6 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-amber border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen md:pl-56 pb-20 md:pb-0 p-6">
      <div className="max-w-[1550px] mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6 animate-fade-in">
          <Link
            href={`/strategies/${strategyId}`}
            className="btn-ghost p-1.5 rounded-lg inline-flex items-center"
            aria-label="Volver"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="font-display font-800 text-2xl md:text-3xl text-white tracking-tight">
              Performance
            </h1>
            {strategy && (
              <p className="text-slate-400 text-sm mt-0.5">{strategy.name}</p>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="glass rounded-2xl p-4 border border-white/[0.08] mb-6 flex flex-wrap items-center gap-4">
          {strategy && strategy.tickers.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-[11px] font-mono uppercase tracking-wider">Ticker</span>
              <select
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                className="bg-white/[0.04] border border-white/[0.08] rounded-lg text-slate-300 text-[11px] font-mono px-2.5 py-1 focus:outline-none focus:border-amber/40"
              >
                <option value="all">Todos</option>
                {strategy.tickers.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-[11px] font-mono uppercase tracking-wider">Tipo</span>
            <PillSelector options={TYPE_OPTIONS} value={signalType} onChange={setSignalType} />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 border-b border-white/[0.08] mb-6">
          <button
            onClick={() => setActiveTab('comparison')}
            className={`pb-3 text-sm font-display font-600 transition-colors ${
              activeTab === 'comparison'
                ? 'text-white border-b-2 border-tv-green -mb-px'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Comparación
          </button>
          <button
            onClick={() => setActiveTab('signals')}
            className={`pb-3 text-sm font-display font-600 transition-colors ${
              activeTab === 'signals'
                ? 'text-white border-b-2 border-tv-green -mb-px'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Señales
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'comparison' && performance && (
          <ComparisonTab setups={performance.setups} bestSetupId={performance.best_setup_id} />
        )}

        {activeTab === 'signals' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-[11px] font-mono uppercase tracking-wider">Período</span>
              <PillSelector options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
            </div>
            <SignalsTab signals={signals} loading={loadingSignals} />
          </div>
        )}

      </div>
    </div>
  )
}
