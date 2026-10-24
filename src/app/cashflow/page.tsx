'use client'

import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { formatUSD } from '@/lib/utils'
import { requestErrorMessage } from '@/lib/request-errors'
import type { Cashflow } from '@/types'
import { SectionHead } from '@/components/resumen/ui'
import ExpenseList, { type Sort, type SortKey } from './ExpenseList'
import ExpenseDialog from './ExpenseDialog'
import CategoryBreakdown from './CategoryBreakdown'
import MonthlyTrend from './MonthlyTrend'

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const primaryButton = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 font-medium text-primary-on hover:bg-primary-hover max-[819px]:min-h-11'
const stepButton = 'grid h-9 w-9 place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink max-[819px]:h-11 max-[819px]:w-11'
const LOAD_FAILED = 'No se pudieron cargar los gastos.'
const select = 'min-h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink hover:border-ink-3 max-[819px]:min-h-11'

export default function CashflowPage() {
  const [items, setItems] = useState<Cashflow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)
  const [stats, setStats] = useState({ totalPending: 0, overdueCount: 0 })

  // Month navigation
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth()) // 0-indexed
  const [viewAll, setViewAll] = useState(false)

  const [sort, setSort] = useState<Sort>({ key: 'date', dir: 'desc' })
  const [filterCategory, setFilterCategory] = useState<string>('all')

  async function fetchData() {
    setLoading(true)
    try {
      const res = await fetch('/api/cashflow')
      if (!res.ok) throw new Error(LOAD_FAILED)
      const data = await res.json()
      setItems(data.data ?? [])
      setStats({ totalPending: data.totalPending ?? 0, overdueCount: data.overdueCount ?? 0 })
      setLoadError(null)
    } catch (err) {
      setLoadError(requestErrorMessage(err, LOAD_FAILED))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  /** Sends one row's change; its buttons stay disabled until the list reloads. */
  async function send(item: Cashflow, method: 'PATCH' | 'DELETE', body: object, failed: string, done: string) {
    setBusyIds(ids => [...ids, item.id])
    try {
      const res = await fetch('/api/cashflow', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || failed)
      toast.success(done)
      await fetchData()
    } catch (err) {
      toast.error(requestErrorMessage(err, failed))
    } finally {
      setBusyIds(ids => ids.filter(id => id !== item.id))
    }
  }

  function toggleStatus(item: Cashflow) {
    const paid = item.status !== 'PAGADO'
    return send(item, 'PATCH', { id: item.id, status: paid ? 'PAGADO' : 'PENDIENTE' },
      'No se pudo cambiar el estado del gasto', paid ? 'Marcado como pagado' : 'Marcado como pendiente')
  }

  function deleteItem(item: Cashflow) {
    return send(item, 'DELETE', { id: item.id }, 'No se pudo borrar el gasto', 'Gasto borrado')
  }

  const filteredByMonth = useMemo(() => {
    if (viewAll) return items
    return items.filter(item => {
      const d = new Date(item.date + 'T00:00:00')
      return d.getFullYear() === selectedYear && d.getMonth() === selectedMonth
    })
  }, [items, selectedYear, selectedMonth, viewAll])

  const filteredItems = useMemo(() => {
    if (filterCategory === 'all') return filteredByMonth
    return filteredByMonth.filter(item => item.category === filterCategory)
  }, [filteredByMonth, filterCategory])

  const sortedItems = useMemo(() => {
    const { key: sortKey, dir: sortDir } = sort
    return [...filteredItems].sort((a, b) => {
      if (sortKey === 'date') {
        const da = new Date(a.date).getTime()
        const db = new Date(b.date).getTime()
        return sortDir === 'asc' ? da - db : db - da
      }
      if (sortKey === 'amount_usd') {
        return sortDir === 'asc' ? a.amount_usd - b.amount_usd : b.amount_usd - a.amount_usd
      }
      const va = (a[sortKey] ?? '').toString().toLowerCase()
      const vb = (b[sortKey] ?? '').toString().toLowerCase()
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    })
  }, [filteredItems, sort])

  const monthTotal = filteredByMonth.reduce((s, i) => s + i.amount_usd, 0)
  const monthPaid = filteredByMonth.filter(i => i.status === 'PAGADO').reduce((s, i) => s + i.amount_usd, 0)
  const monthPending = filteredByMonth.filter(i => i.status === 'PENDIENTE').reduce((s, i) => s + i.amount_usd, 0)

  const categoryData = useMemo(() => {
    const map = new Map<string, number>()
    filteredByMonth.forEach(item => {
      map.set(item.category, (map.get(item.category) || 0) + item.amount_usd)
    })
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [filteredByMonth])

  // Monthly trend (last 12 months with data)
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach(item => {
      const d = new Date(item.date + 'T00:00:00')
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map.set(key, (map.get(key) || 0) + item.amount_usd)
    })
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, total]) => {
        const [y, m] = month.split('-')
        return { month, label: `${MONTH_NAMES[parseInt(m) - 1]?.slice(0, 3)} ${y.slice(2)}`, total }
      })
  }, [items])

  const usedCategories = useMemo(() => {
    const set = new Set<string>()
    filteredByMonth.forEach(i => set.add(i.category))
    return Array.from(set).sort()
  }, [filteredByMonth])

  function prevMonth() {
    if (selectedMonth === 0) { setSelectedMonth(11); setSelectedYear(y => y - 1) }
    else setSelectedMonth(m => m - 1)
  }
  function nextMonth() {
    if (selectedMonth === 11) { setSelectedMonth(0); setSelectedYear(y => y + 1) }
    else setSelectedMonth(m => m + 1)
  }

  function handleSort(key: SortKey) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  }

  const period = viewAll ? 'Todos los meses' : `${MONTH_NAMES[selectedMonth]} ${selectedYear}`
  const loaded = !loading || items.length > 0

  return (
    <div className="mx-auto w-full max-w-[1240px] px-10 pb-16 pt-8 max-[819px]:px-4 max-[819px]:pb-24 max-[819px]:pt-5">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl">Gastos</h1>
          <p className="mt-1 text-ink-3">Control de gastos personales por categoría y mes.</p>
        </div>
        <button type="button" onClick={() => setShowForm(true)} className={`${primaryButton} max-[819px]:w-full`}>
          <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Nuevo gasto
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3">
        <div className="-ml-2 flex items-center gap-1 max-[819px]:-ml-3" role="group" aria-label="Mes">
          <button type="button" onClick={prevMonth} disabled={viewAll} aria-label="Mes anterior" className={`${stepButton} disabled:opacity-40`}>
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
          <span aria-live="polite" className="min-w-[132px] text-center text-base font-semibold">{period}</span>
          <button type="button" onClick={nextMonth} disabled={viewAll} aria-label="Mes siguiente" className={`${stepButton} disabled:opacity-40`}>
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <button type="button" onClick={() => setViewAll(v => !v)} aria-pressed={viewAll}
          className="inline-flex min-h-8 items-center text-[13px] font-medium text-accent-ink hover:underline hover:underline-offset-2 max-[819px]:min-h-11">
          {viewAll ? 'Ver un mes' : 'Ver todos los meses'}
        </button>
      </div>

      {loadError && (
        <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {loadError}
          <button type="button" onClick={() => fetchData()} className="font-medium underline underline-offset-2 max-[819px]:min-h-11">Reintentar</button>
        </div>
      )}

      {!loaded && !loadError && (
        <div role="status" aria-label="Cargando gastos" className="mt-6 grid gap-3">
          {[0, 1, 2, 3].map(i => <span key={i} className="block h-14 animate-pulse rounded bg-surface-2" />)}
        </div>
      )}

      {loaded && !loadError && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-1 pt-5">
            <strong className="font-serif text-[2rem] font-normal leading-[1.1] tracking-[-0.01em] tabular-nums max-[819px]:text-2xl">{formatUSD(monthTotal)}</strong>
            <span className="text-ink-3">gastados en {filteredByMonth.length} {filteredByMonth.length === 1 ? 'registro' : 'registros'}</span>
          </div>
          <dl className="grid grid-cols-3 gap-4 border-b border-line pb-5 pt-3 max-[819px]:grid-cols-2">
            <div>
              <dt className="text-[13px] text-ink-3">Pagado</dt>
              <dd className="text-base font-medium tabular-nums">{formatUSD(monthPaid)}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-ink-3">Pendiente</dt>
              <dd className="text-base font-medium tabular-nums">{formatUSD(monthPending)}</dd>
              {stats.overdueCount > 0 && (
                <dd className="text-[13px] text-danger">{stats.overdueCount} {stats.overdueCount > 1 ? 'vencidos' : 'vencido'}</dd>
              )}
            </div>
            <div className="max-[819px]:col-span-2">
              <dt className="text-[13px] text-ink-3">Categorías</dt>
              <dd className="text-base font-medium tabular-nums">{categoryData.length}</dd>
            </div>
          </dl>

          <div className="mt-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-10 max-[1080px]:grid-cols-[minmax(0,1fr)]">
            <CategoryBreakdown items={categoryData} total={monthTotal} period={period} />
            <MonthlyTrend data={monthlyTrend} />
          </div>

          <section aria-labelledby="h-detalle" className="mt-10">
            <SectionHead
              id="h-detalle"
              title="Detalle"
              count={sortedItems.length}
              action={
                <span className="flex items-center gap-2">
                  <label htmlFor="filter-category" className="text-[13px] text-ink-3">Categoría</label>
                  <select id="filter-category" value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={select}>
                    <option value="all">Todas</option>
                    {usedCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </span>
              }
            />
            {sortedItems.length === 0
              ? <p className="py-4 text-[13px] text-ink-3">Sin gastos en este período.</p>
              : <div className="pt-1"><ExpenseList items={sortedItems} sort={sort} onSort={handleSort} onToggle={toggleStatus} onDelete={deleteItem} busyIds={busyIds} /></div>}
          </section>
        </>
      )}

      <ExpenseDialog open={showForm} onClose={() => setShowForm(false)} onSaved={fetchData} />
    </div>
  )
}
