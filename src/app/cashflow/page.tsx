'use client'

import { useState, useEffect, useMemo } from 'react'
import { formatUSD, formatDate, cn } from '@/lib/utils'
import type { Cashflow } from '@/types'
import { Plus, AlertCircle, CheckCircle, Clock, Trash2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area,
} from 'recharts'

const CATEGORIES = [
  'Alquiler', 'Servicios', 'Supermercado', 'Transporte', 'Salud',
  'Educación', 'Entretenimiento', 'Restaurantes', 'Ropa', 'Tecnología',
  'Impuestos', 'Seguros', 'Suscripciones', 'Honorarios', 'Inversiones',
  'Retiro', 'Depósito', 'Otro'
]

const CATEGORY_COLORS: Record<string, string> = {
  'Alquiler': '#F59E0B', 'Servicios': '#10B981', 'Supermercado': '#3B82F6',
  'Transporte': '#6366F1', 'Salud': '#EC4899', 'Educación': '#8B5CF6',
  'Entretenimiento': '#EF4444', 'Restaurantes': '#F97316', 'Ropa': '#06B6D4',
  'Tecnología': '#84CC16', 'Impuestos': '#64748B', 'Seguros': '#14B8A6',
  'Suscripciones': '#A855F7', 'Honorarios': '#D946EF', 'Inversiones': '#22D3EE',
  'Retiro': '#FB923C', 'Depósito': '#34D399', 'Otro': '#94A3B8',
}

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const TOOLTIP_STYLE = { backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }

type SortKey = 'date' | 'category' | 'description' | 'amount_usd' | 'status'
type SortDir = 'asc' | 'desc'

export default function CashflowPage() {
  const [items, setItems] = useState<Cashflow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    category: 'Supermercado',
    description: '',
    amount_usd: '',
    status: 'PAGADO'
  })
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState({ totalPending: 0, overdueCount: 0 })

  // Month navigation
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth()) // 0-indexed
  const [viewAll, setViewAll] = useState(false)

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Filter
  const [filterCategory, setFilterCategory] = useState<string>('all')

  async function fetchData() {
    setLoading(true)
    try {
      const res = await fetch('/api/cashflow')
      const data = await res.json()
      setItems(data.data ?? [])
      setStats({ totalPending: data.totalPending ?? 0, overdueCount: data.overdueCount ?? 0 })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch('/api/cashflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount_usd: parseFloat(form.amount_usd) }),
      })
      setShowForm(false)
      setForm({ date: new Date().toISOString().split('T')[0], category: 'Supermercado', description: '', amount_usd: '', status: 'PAGADO' })
      fetchData()
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(item: Cashflow) {
    await fetch('/api/cashflow', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, status: item.status === 'PAGADO' ? 'PENDIENTE' : 'PAGADO' }),
    })
    fetchData()
  }

  async function deleteItem(id: string) {
    if (!confirm('¿Eliminar este gasto?')) return
    await fetch('/api/cashflow', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchData()
  }

  // Filter items by selected month
  const filteredByMonth = useMemo(() => {
    if (viewAll) return items
    return items.filter(item => {
      const d = new Date(item.date + 'T00:00:00')
      return d.getFullYear() === selectedYear && d.getMonth() === selectedMonth
    })
  }, [items, selectedYear, selectedMonth, viewAll])

  // Filter by category
  const filteredItems = useMemo(() => {
    if (filterCategory === 'all') return filteredByMonth
    return filteredByMonth.filter(item => item.category === filterCategory)
  }, [filteredByMonth, filterCategory])

  // Sorted items
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      if (sortKey === 'date') {
        const da = new Date(a.date).getTime()
        const db = new Date(b.date).getTime()
        return sortDir === 'asc' ? da - db : db - da
      }
      if (sortKey === 'amount_usd') {
        return sortDir === 'asc' ? a.amount_usd - b.amount_usd : b.amount_usd - a.amount_usd
      }
      const va = ((a as any)[sortKey] ?? '').toString().toLowerCase()
      const vb = ((b as any)[sortKey] ?? '').toString().toLowerCase()
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    })
  }, [filteredItems, sortKey, sortDir])

  // Stats for current view
  const monthTotal = filteredByMonth.reduce((s, i) => s + i.amount_usd, 0)
  const monthPaid = filteredByMonth.filter(i => i.status === 'PAGADO').reduce((s, i) => s + i.amount_usd, 0)
  const monthPending = filteredByMonth.filter(i => i.status === 'PENDIENTE').reduce((s, i) => s + i.amount_usd, 0)

  // Category breakdown for pie chart
  const categoryData = useMemo(() => {
    const map = new Map<string, number>()
    filteredByMonth.forEach(item => {
      const current = map.get(item.category) || 0
      map.set(item.category, current + item.amount_usd)
    })
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [filteredByMonth])

  // Monthly trend (last 6 months)
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

  // Category breakdown bar chart (for current month)
  const categoryBarData = useMemo(() => {
    return categoryData.slice(0, 10)
  }, [categoryData])

  // Available categories from data (for filter)
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
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function SortIcon({ colKey }: { colKey: SortKey }) {
    if (sortKey !== colKey) return <ChevronDown className="w-3 h-3 text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity" />
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-amber" /> : <ChevronDown className="w-3 h-3 text-amber" />
  }

  const isOverdue = (item: Cashflow) => item.status === 'PENDIENTE' && new Date(item.date) < new Date()

  return (
    <div className="min-h-screen md:pl-56 pb-20 md:pb-0">
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 animate-fade-in">
          <div>
            <h1 className="font-display font-800 text-2xl md:text-3xl text-white tracking-tight">
              Gastos <span className="text-amber text-glow-amber">& Cash Flow</span>
            </h1>
            <p className="text-slate-500 font-mono text-sm mt-1">Control de gastos personales por categoría y mes</p>
          </div>
          <button onClick={() => setShowForm(s => !s)} className="btn-primary flex items-center gap-2 text-xs">
            <Plus className="w-3.5 h-3.5" />
            Nuevo Gasto
          </button>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center gap-3 mb-6">
          <div className="glass rounded-xl px-1 py-1 flex items-center gap-1">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-slate-400 hover:text-white">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-display font-700 text-white text-sm px-3 min-w-[140px] text-center">
              {MONTH_NAMES[selectedMonth]} {selectedYear}
            </span>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-slate-400 hover:text-white">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={() => setViewAll(v => !v)}
            className={cn(
              'text-[10px] font-mono px-3 py-1.5 rounded-full border transition-all',
              viewAll ? 'bg-amber/10 text-amber border-amber/30' : 'bg-white/5 text-slate-500 border-white/10 hover:text-white'
            )}
          >
            {viewAll ? 'TODOS' : 'VER TODO'}
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="kpi-card animate-slide-up" style={{ animationFillMode: 'both' }}>
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">Total Gastos</span>
            <span className="text-2xl font-display font-800 mt-1 text-white">{formatUSD(monthTotal)}</span>
            <span className="text-[10px] text-slate-600 font-mono">{filteredByMonth.length} registros</span>
          </div>
          <div className="kpi-card animate-slide-up" style={{ animationDelay: '60ms', animationFillMode: 'both' }}>
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">Pagado</span>
            <span className="text-2xl font-display font-800 mt-1 text-emerald">{formatUSD(monthPaid)}</span>
          </div>
          <div className="kpi-card animate-slide-up" style={{ animationDelay: '120ms', animationFillMode: 'both' }}>
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">Pendiente</span>
            <span className={cn('text-2xl font-display font-800 mt-1', monthPending > 0 ? 'text-amber' : 'text-white')}>
              {formatUSD(monthPending)}
            </span>
            {stats.overdueCount > 0 && (
              <span className="text-xs font-mono text-rose flex items-center gap-1 mt-0.5">
                <AlertCircle className="w-3 h-3" />{stats.overdueCount} vencido{stats.overdueCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="kpi-card animate-slide-up" style={{ animationDelay: '180ms', animationFillMode: 'both' }}>
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">Categorías</span>
            <span className="text-2xl font-display font-800 mt-1 text-white">{categoryData.length}</span>
            <span className="text-[10px] text-slate-600 font-mono">con gastos este mes</span>
          </div>
        </div>

        {/* Add form */}
        {showForm && (
          <form onSubmit={handleSave} className="glass rounded-2xl p-4 md:p-5 mb-5 border border-amber/20 animate-slide-up">
            <h3 className="font-display font-700 text-white mb-4">Nuevo gasto</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Fecha</label>
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="input-field w-full" required />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Categoría</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="input-field w-full">
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Monto USD</label>
                <input type="number" step="any" placeholder="0.00" value={form.amount_usd}
                  onChange={e => setForm(f => ({ ...f, amount_usd: e.target.value }))}
                  className="input-field w-full" required />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Estado</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="input-field w-full">
                  <option>PAGADO</option>
                  <option>PENDIENTE</option>
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Descripción</label>
                <input type="text" placeholder="Descripción del gasto..." value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="input-field w-full" />
              </div>
              <div className="flex items-end">
                <div className="flex gap-2 w-full">
                  <button type="button" onClick={() => setShowForm(false)} className="btn-ghost text-xs flex-1">Cancelar</button>
                  <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center text-xs flex items-center gap-2">
                    {saving ? <div className="w-3.5 h-3.5 border-2 border-bg-900/30 border-t-bg-900 rounded-full animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Guardar
                  </button>
                </div>
              </div>
            </div>
          </form>
        )}

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Category Pie Chart */}
          <div className="glass rounded-2xl p-4 md:p-6">
            <h3 className="font-display font-700 text-white mb-1">Gastos por Categoría</h3>
            <p className="text-[11px] text-slate-500 font-mono mb-3">
              {viewAll ? 'Todos los meses' : `${MONTH_NAMES[selectedMonth]} ${selectedYear}`}
            </p>
            {categoryData.length > 0 ? (
              <div className="flex flex-col gap-3">
                <div className="relative h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={categoryData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value" stroke="none">
                        {categoryData.map((entry, i) => (
                          <Cell key={i} fill={CATEGORY_COLORS[entry.name] || '#64748B'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatUSD(value)} contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#fff', fontSize: '13px', fontFamily: 'monospace' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[10px] font-mono text-slate-500 uppercase">Total</span>
                    <span className="font-display font-700 text-white text-lg">{formatUSD(monthTotal)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {categoryData.map(item => (
                    <div key={item.name} className="flex items-center gap-2 text-[11px] font-mono">
                      <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[item.name] || '#64748B' }} />
                      <span className="text-slate-400 truncate">{item.name}</span>
                      <span className="text-slate-600 ml-auto">{formatUSD(item.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-slate-500 font-mono text-sm">Sin gastos este mes</div>
            )}
          </div>

          {/* Monthly Trend */}
          <div className="glass rounded-2xl p-4 md:p-6">
            <h3 className="font-display font-700 text-white mb-1">Evolución Mensual</h3>
            <p className="text-[11px] text-slate-500 font-mono mb-3">Total de gastos por mes (últimos 12 meses)</p>
            {monthlyTrend.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyTrend}>
                    <defs>
                      <linearGradient id="gradExpense" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#132035" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatUSD(v, true)} />
                    <Tooltip formatter={(value: number) => [formatUSD(value), 'Total']} contentStyle={TOOLTIP_STYLE} />
                    <Area type="monotone" dataKey="total" stroke="#F59E0B" strokeWidth={2} fill="url(#gradExpense)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-slate-500 font-mono text-sm">Sin datos aún</div>
            )}
          </div>
        </div>

        {/* Category Bar Chart */}
        {categoryBarData.length > 0 && (
          <div className="glass rounded-2xl p-4 md:p-6 mb-6">
            <h3 className="font-display font-700 text-white mb-1">Desglose por Categoría</h3>
            <p className="text-[11px] text-slate-500 font-mono mb-3">
              Ranking de gastos — {viewAll ? 'Todos' : `${MONTH_NAMES[selectedMonth]} ${selectedYear}`}
            </p>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryBarData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#132035" vertical={false} />
                  <XAxis type="number" tickFormatter={(v: number) => formatUSD(v, true)} tick={{ fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} width={100} />
                  <Tooltip formatter={(value: number) => formatUSD(value)} cursor={{ fill: 'rgba(255,255,255,0.02)' }} contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {categoryBarData.map((entry, index) => (
                      <Cell key={index} fill={CATEGORY_COLORS[entry.name] || '#64748B'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Category Filter */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Filtrar:</span>
          <button
            onClick={() => setFilterCategory('all')}
            className={cn('text-[10px] font-mono px-2.5 py-1 rounded-full border transition-all',
              filterCategory === 'all' ? 'bg-amber/10 text-amber border-amber/30' : 'bg-white/5 text-slate-500 border-white/10 hover:text-white')}
          >
            Todos
          </button>
          {usedCategories.map(cat => (
            <button key={cat}
              onClick={() => setFilterCategory(filterCategory === cat ? 'all' : cat)}
              className={cn('text-[10px] font-mono px-2.5 py-1 rounded-full border transition-all',
                filterCategory === cat ? 'bg-amber/10 text-amber border-amber/30' : 'bg-white/5 text-slate-500 border-white/10 hover:text-white')}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Expenses Table */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.05]">
            <h3 className="font-display font-700 text-white">Detalle de Gastos</h3>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
              {sortedItems.length} registros · Click en columna para ordenar
            </p>
          </div>

          {/* DESKTOP TABLE */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  <th className="text-left px-4 py-3 text-[10px] font-mono text-slate-600 uppercase tracking-widest w-[80px]">ESTADO</th>
                  {([
                    { label: 'FECHA', key: 'date' as SortKey },
                    { label: 'CATEGORÍA', key: 'category' as SortKey },
                    { label: 'DESCRIPCIÓN', key: 'description' as SortKey },
                    { label: 'MONTO', key: 'amount_usd' as SortKey },
                  ]).map(col => (
                    <th key={col.key} onClick={() => handleSort(col.key)}
                      className="group text-left px-4 py-3 text-[10px] font-mono text-slate-600 uppercase tracking-widest cursor-pointer select-none hover:text-slate-400 transition-colors">
                      <span className="inline-flex items-center gap-1">{col.label}<SortIcon colKey={col.key} /></span>
                    </th>
                  ))}
                  <th className="w-[40px]"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin mx-auto" />
                  </td></tr>
                ) : sortedItems.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-slate-600 font-mono text-sm">
                    Sin gastos en este período
                  </td></tr>
                ) : sortedItems.map((item, i) => {
                  const overdue = isOverdue(item)
                  return (
                    <tr key={item.id}
                      className={cn('table-row animate-fade-in', overdue && 'bg-rose/5')}
                      style={{ animationDelay: `${i * 15}ms`, animationFillMode: 'both' }}>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleStatus(item)}
                          className={cn('inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border transition-all duration-150',
                            item.status === 'PAGADO' ? 'tag-positive hover:opacity-70'
                              : overdue ? 'bg-rose/10 text-rose border-rose/30 hover:opacity-70'
                                : 'bg-amber/10 text-amber border-amber/30 hover:opacity-70')}>
                          {item.status === 'PAGADO' ? <><CheckCircle className="w-3 h-3" /> OK</>
                            : overdue ? <><AlertCircle className="w-3 h-3" /> !</>
                              : <><Clock className="w-3 h-3" /> ⏳</>}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{formatDate(item.date)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-300">
                          <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[item.category] || '#64748B' }} />
                          {item.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-400 max-w-[300px] truncate">{item.description ?? '—'}</td>
                      <td className="px-4 py-3 font-mono font-600 text-sm text-white">{formatUSD(item.amount_usd)}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => deleteItem(item.id)} className="p-1 rounded-lg hover:bg-rose/10 text-slate-600 hover:text-rose transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* MOBILE CARDS */}
          <div className="flex md:hidden flex-col divide-y divide-white/[0.05]">
            {loading ? (
              <div className="py-12 flex justify-center">
                <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin" />
              </div>
            ) : sortedItems.length === 0 ? (
              <div className="text-center py-10 text-slate-600 font-mono text-sm">Sin gastos este mes</div>
            ) : sortedItems.map((item, i) => {
              const overdue = isOverdue(item)
              return (
                <div key={`mob-${item.id}`}
                  className={cn('p-4 flex items-center justify-between animate-fade-in', overdue && 'bg-rose/5')}
                  style={{ animationDelay: `${i * 15}ms`, animationFillMode: 'both' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[item.category] || '#64748B' }} />
                      <p className="font-display font-700 text-sm text-white truncate">{item.category}</p>
                    </div>
                    {item.description && <p className="text-[11px] text-slate-500 truncate">{item.description}</p>}
                    <p className="text-[10px] text-slate-600 font-mono mt-0.5">{formatDate(item.date)}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <p className="font-mono font-600 text-sm text-white">{formatUSD(item.amount_usd)}</p>
                    <button onClick={() => toggleStatus(item)}
                      className={cn('p-1 rounded-full',
                        item.status === 'PAGADO' ? 'text-emerald' : overdue ? 'text-rose' : 'text-amber')}>
                      {item.status === 'PAGADO' ? <CheckCircle className="w-4 h-4" /> : overdue ? <AlertCircle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
