'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Upload, TrendingUp, Landmark, Banknote } from 'lucide-react'
import PositionsTable from '@/components/ui/PositionsTable'
import ONsSection from '@/components/ui/ONsSection'
import CashSection from '@/components/ui/CashSection'
import AddTransactionModal from '@/components/ui/AddTransactionModal'
import ImportModal from '@/components/ui/ImportModal'
import type { Position, ONPosition, PortfolioSummary } from '@/types'
import { formatUSD, formatPct, cn, isMarketOpen } from '@/lib/utils'

const REFRESH_INTERVAL_SEC = 300

// ─── Breakdown bar helper ─────────────────────────────────
function BreakdownBar({
  stocks, ons, cash, total,
}: { stocks: number; ons: number; cash: number; total: number }) {
  if (total <= 0) return null
  const sp = (stocks / total) * 100
  const op = (ons / total) * 100
  const cp = (cash / total) * 100
  return (
    <div className="w-full">
      <div className="flex h-1.5 rounded-full overflow-hidden gap-0.5 mt-2">
        {sp > 0 && <div className="h-full bg-blue-400 rounded-full transition-all duration-500" style={{ width: `${sp}%` }} />}
        {op > 0 && <div className="h-full bg-amber rounded-full transition-all duration-500" style={{ width: `${op}%` }} />}
        {cp > 0 && <div className="h-full bg-emerald rounded-full transition-all duration-500" style={{ width: `${cp}%` }} />}
      </div>
      <div className="flex gap-3 mt-2">
        <span className="text-[9px] font-mono text-blue-400">ACC {sp.toFixed(0)}%</span>
        <span className="text-[9px] font-mono text-amber">ONs {op.toFixed(0)}%</span>
        <span className="text-[9px] font-mono text-emerald">CASH {cp.toFixed(0)}%</span>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [onPositions, setOnPositions] = useState<ONPosition[]>([])
  const [cedears, setCedears] = useState<any[]>([])
  const [cashBalance, setCashBalance] = useState<number>(0)
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [positionsLoading, setPositionsLoading] = useState(true)
  const [showAddTx, setShowAddTx] = useState(false)
  const [quickSellData, setQuickSellData] = useState<{ assetClass: any; ticker: string; quantity: number; price: number } | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [marketOpen, setMarketOpen] = useState(isMarketOpen())
  const [autoRefresh, setAutoRefresh] = useState(isMarketOpen())
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)

  const countdownRef = useRef(REFRESH_INTERVAL_SEC)
  const [displayCountdown, setDisplayCountdown] = useState(REFRESH_INTERVAL_SEC)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleQuickSell = (assetClass: any, ticker: string, quantity: number, price: number) => {
    // If it's potentially a stock/cedear, check against cedears list
    let finalClass = assetClass
    if (assetClass === 'ACCION') {
      const isCedear = cedears.some(c => c.ticker === ticker || ticker.includes(c.ticker))
      if (isCedear) finalClass = 'CEDEAR'
    }

    setQuickSellData({ assetClass: finalClass, ticker, quantity, price })
    setShowAddTx(true)
  }

  const fetchPositionsData = useCallback(async () => {
    setPositionsLoading(true)
    try {
      const [posRes, cedRes] = await Promise.all([
        fetch('/api/positions'),
        fetch('/api/cedears')
      ])
      
      const posData = await posRes.json()
      if (cedRes.ok) setCedears(await cedRes.json())

      setPositions(posData.positions ?? [])
      setOnPositions(posData.onPositions ?? [])
      setCashBalance(posData.summary?.cash?.balance ?? 0)
      setSummary(posData.summary ?? null)

      if (posData.lastRefresh) {
        setLastUpdate(posData.lastRefresh)
        const last = new Date(posData.lastRefresh)
        const now = new Date()
        const elapsed = Math.floor((now.getTime() - last.getTime()) / 1000)
        const remaining = Math.max(1, REFRESH_INTERVAL_SEC - (elapsed % REFRESH_INTERVAL_SEC))
        countdownRef.current = remaining
        setDisplayCountdown(remaining)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setPositionsLoading(false)
    }
  }, [])

  const fetchAllData = useCallback(async () => {
    await fetchPositionsData()
  }, [fetchPositionsData])

  useEffect(() => { fetchPositionsData() }, [fetchPositionsData])

  // Sync market state and autoRefresh
  useEffect(() => {
    const checkMarket = () => {
      const open = isMarketOpen()
      setMarketOpen(open)
      // If market just closed, stop refreshing
      if (!open && autoRefresh) setAutoRefresh(false)
    }
    
    checkMarket()
    const timer = setInterval(checkMarket, 60000) // Check every minute
    return () => clearInterval(timer)
  }, [autoRefresh])

  useEffect(() => {
    if (!autoRefresh || !marketOpen) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    intervalRef.current = setInterval(() => {
      countdownRef.current -= 1
      setDisplayCountdown(countdownRef.current)
      if (countdownRef.current <= 0) {
        countdownRef.current = REFRESH_INTERVAL_SEC
        setDisplayCountdown(REFRESH_INTERVAL_SEC)
        fetchPositionsData()
      }
    }, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, marketOpen])

  // ── Derived values ─────────────────────────────────────
  const totalMarketValue = summary?.total_market_value ?? 0
  const stocksValue = summary?.stocks?.market_value ?? 0
  const onsValue = summary?.ons?.market_value ?? 0
  const cashValue = summary?.cash?.balance ?? cashBalance

  const lastUpdateDisplay = lastUpdate
    ? new Date(lastUpdate).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div className="min-h-screen md:pl-56 pb-20 md:pb-0">
      <div className="max-w-[1550px] mx-auto px-4 md:px-8 py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 animate-fade-in">
          <div>
            <h1 className="font-display font-800 text-2xl md:text-3xl text-white tracking-tight">
              Portfolio
              <span className="text-amber text-glow-amber"> Overview</span>
            </h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <p className="text-slate-400 font-mono text-sm hidden sm:block">
                {new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
              <button
                onClick={() => setAutoRefresh(a => !a)}
                disabled={!marketOpen}
                className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full border transition-all duration-200 ${
                  !marketOpen
                    ? 'bg-slate-500/10 text-slate-400 border-slate-500/20 cursor-default'
                    : autoRefresh
                    ? 'bg-emerald/10 text-emerald border-emerald/30 hover:bg-emerald/20'
                    : 'bg-amber/10 text-amber border-amber/30 hover:bg-amber/20'
                }`}
                title={!marketOpen ? 'Mercado cerrado' : autoRefresh ? `Auto-refresh en ${displayCountdown}s` : 'Click para activar'}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${!marketOpen ? 'bg-slate-500' : autoRefresh ? 'bg-emerald animate-pulse' : 'bg-amber'}`} />
                <span className="hidden sm:inline">{!marketOpen ? 'MERCADO CERRADO' : autoRefresh ? `LIVE · ${displayCountdown}s` : 'PAUSED'}</span>
                <span className="sm:hidden">{!marketOpen ? 'CERRADO' : autoRefresh ? 'LIVE' : 'PAUSED'}</span>
              </button>
              {lastUpdateDisplay && (
                <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
                  Últ. cotización: {lastUpdateDisplay}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <button onClick={() => setShowImport(true)}
              className="btn-ghost flex-1 sm:flex-none justify-center flex items-center gap-2 text-xs">
              <Upload className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              <span className="hidden md:inline">Importar Excel</span>
            </button>
            <button onClick={() => setShowAddTx(true)}
              className="btn-primary inline-flex justify-center items-center gap-2 text-xs whitespace-nowrap">
              <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              <span>Nueva Operación</span>
            </button>
          </div>
        </div>

        {/* ── KPI Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">

          {/* Card 1: Total + Breakdown */}
          <div className="glass rounded-2xl p-5 animate-slide-up" style={{ animationDelay: '0ms', animationFillMode: 'both' }}>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[11px] font-mono text-slate-400 uppercase tracking-widest">Valor de Mercado</p>
                <p className="text-3xl font-bold text-white mt-1">{formatUSD(totalMarketValue)}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-mono text-slate-400 uppercase tracking-widest">Monto Inicial</p>
                <p className="text-xl font-bold text-slate-300 mt-1">{formatUSD((summary?.total_invested ?? 0) + cashValue)}</p>
              </div>
            </div>
            <BreakdownBar stocks={stocksValue} ons={onsValue} cash={cashValue} total={totalMarketValue} />
            <div className="mt-3 pt-3 border-t border-white/[0.05] grid grid-cols-3 gap-2">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <TrendingUp className="w-3 h-3 text-blue-400" />
                  <span className="text-[9px] font-mono text-slate-600 uppercase">Acc</span>
                </div>
                <p className="text-xs font-mono font-600 text-white">{formatUSD(stocksValue)}</p>
              </div>
              <div className="text-center border-x border-white/[0.05]">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <Landmark className="w-3 h-3 text-amber" />
                  <span className="text-[9px] font-mono text-slate-600 uppercase">ONs</span>
                </div>
                <p className="text-xs font-mono font-600 text-white">{formatUSD(onsValue)}</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <Banknote className="w-3 h-3 text-emerald" />
                  <span className="text-[9px] font-mono text-slate-600 uppercase">Cash</span>
                </div>
                <p className="text-xs font-mono font-600 text-white">{formatUSD(cashValue)}</p>
              </div>
            </div>
          </div>

          {/* Card 2: P&L Abierto */}
          <div className="glass rounded-2xl p-5 animate-slide-up" style={{ animationDelay: '100ms', animationFillMode: 'both' }}>
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-widest">P&L Abierto</p>
            <p className={`text-3xl font-bold mt-1 ${(summary?.open_pnl ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
              {formatUSD(summary?.open_pnl ?? 0)}
            </p>
            <div className="mt-4 pt-3 border-t border-white/[0.05] flex justify-between items-end">
              <div>
                <p className="text-[10px] font-mono text-slate-500 uppercase">Porcentaje</p>
                <p className={`text-lg font-bold mt-0.5 ${(summary?.open_pnl_pct ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
                  {formatPct(summary?.open_pnl_pct ?? 0)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-mono text-slate-500 uppercase">Realizado</p>
                <p className={`text-lg font-bold mt-0.5 ${(summary?.realized_pnl ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
                  {formatUSD(summary?.realized_pnl ?? 0)}
                </p>
              </div>
            </div>
          </div>

          {/* Card 3: P&L Diario */}
          <div className="glass rounded-2xl p-5 animate-slide-up" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-widest">P&L Diario</p>
            <p className={`text-3xl font-bold mt-1 ${(summary?.day_pnl ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
              {formatUSD(summary?.day_pnl ?? 0)}
            </p>
            <div className="mt-4 pt-3 border-t border-white/[0.05] flex justify-between items-end">
              <div>
                <p className="text-[10px] font-mono text-slate-500 uppercase">Variación</p>
                <p className={`text-lg font-bold mt-0.5 ${(summary?.day_pnl_pct ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
                  {summary?.day_pnl_pct !== undefined ? `${(summary.day_pnl_pct * 100).toFixed(2)}%` : '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-mono text-slate-500 uppercase">Total P&L</p>
                <p className={cn('text-lg font-bold mt-0.5', ((summary?.open_pnl ?? 0) + (summary?.realized_pnl ?? 0)) >= 0 ? 'text-emerald' : 'text-rose')}>
                  {formatUSD((summary?.open_pnl ?? 0) + (summary?.realized_pnl ?? 0))}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── 3 Sections ── */}
        <div className="space-y-6">
          {/* Section 1: Acciones/CEDEARs */}
          <PositionsTable 
            positions={positions} 
            loading={positionsLoading} 
            summary={summary?.stocks} 
            onSell={(t, q, p) => handleQuickSell('ACCION', t, q, p)}
          />

          {/* Section 2: ONs */}
          {(onPositions.length > 0) && (
            <ONsSection 
              positions={onPositions} 
              loading={positionsLoading} 
              summary={summary?.ons} 
              onSell={(t, q, p) => handleQuickSell('ON', t, q, p)}
            />
          )}

          {/* Section 3: Cash */}
          <CashSection
            balance={cashValue}
            loading={positionsLoading}
            onMovementDeleted={fetchAllData}
          />
        </div>

      </div>

      {showAddTx && (
        <AddTransactionModal 
          onClose={() => { setShowAddTx(false); setQuickSellData(null) }} 
          onSuccess={fetchAllData} 
          initialData={quickSellData ?? undefined}
        />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onSuccess={fetchAllData} />}
    </div>
  )
}
