'use client'

import { useState, useEffect } from 'react'
import { formatUSD, formatDate, cn } from '@/lib/utils'
import type { Cashflow } from '@/types'
import { Plus, AlertCircle, CheckCircle, Clock } from 'lucide-react'

const CATEGORIES = ['Gastos Fijos', 'Honorarios', 'Impuestos', 'Retiro', 'Depósito', 'Otro']

export default function CashflowPage() {
  const [items, setItems] = useState<Cashflow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], category: 'Gastos Fijos', description: '', amount_usd: '', status: 'PENDIENTE' })
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState({ totalPending: 0, overdueCount: 0 })

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
      setForm({ date: new Date().toISOString().split('T')[0], category: 'Gastos Fijos', description: '', amount_usd: '', status: 'PENDIENTE' })
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

  const totalPaid = items.filter(i => i.status === 'PAGADO').reduce((s, i) => s + i.amount_usd, 0)
  const isOverdue = (item: Cashflow) => item.status === 'PENDIENTE' && new Date(item.date) < new Date()

  return (
    <div className="min-h-screen pl-56">
      <div className="max-w-5xl mx-auto px-6 py-8">

        <div className="flex items-start justify-between mb-8 animate-fade-in">
          <div>
            <h1 className="font-display font-800 text-3xl text-white tracking-tight">
              Cash <span className="text-amber text-glow-amber">Flow</span>
            </h1>
            <p className="text-slate-500 font-mono text-sm mt-1">Control de gastos y flujos de caja</p>
          </div>
          <button onClick={() => setShowForm(s => !s)} className="btn-primary flex items-center gap-2 text-xs">
            <Plus className="w-3.5 h-3.5" />
            Agregar
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="kpi-card animate-slide-up" style={{ animationFillMode: 'both' }}>
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">Pendiente</span>
            <span className={cn('text-2xl font-display font-800 mt-1', stats.totalPending > 0 ? 'text-amber' : 'text-white')}>
              {formatUSD(stats.totalPending)}
            </span>
            {stats.overdueCount > 0 && (
              <span className="text-xs font-mono text-rose flex items-center gap-1 mt-0.5">
                <AlertCircle className="w-3 h-3" />{stats.overdueCount} vencido{stats.overdueCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="kpi-card animate-slide-up" style={{ animationDelay: '60ms', animationFillMode: 'both' }}>
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">Pagado</span>
            <span className="text-2xl font-display font-800 mt-1 text-emerald">{formatUSD(totalPaid)}</span>
          </div>
          <div className="kpi-card animate-slide-up" style={{ animationDelay: '120ms', animationFillMode: 'both' }}>
            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">Total registros</span>
            <span className="text-2xl font-display font-800 mt-1 text-white">{items.length}</span>
          </div>
        </div>

        {/* Add form */}
        {showForm && (
          <form onSubmit={handleSave} className="glass rounded-2xl p-5 mb-5 border border-amber/20 animate-slide-up">
            <h3 className="font-display font-700 text-white mb-4">Nueva entrada</h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
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
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Descripción</label>
                <input type="text" placeholder="Descripción opcional" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="input-field w-full" />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Estado</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="input-field w-full">
                  <option>PENDIENTE</option>
                  <option>PAGADO</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setShowForm(false)} className="btn-ghost text-xs">Cancelar</button>
              <button type="submit" disabled={saving} className="btn-primary text-xs flex items-center gap-2">
                {saving ? <div className="w-3.5 h-3.5 border-2 border-bg-900/30 border-t-bg-900 rounded-full animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Guardar
              </button>
            </div>
          </form>
        )}

        {/* Table */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  {['ESTADO', 'FECHA', 'CATEGORÍA', 'DESCRIPCIÓN', 'MONTO USD'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-mono text-slate-600 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-amber/30 border-t-amber rounded-full animate-spin mx-auto" />
                  </td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-12 text-slate-600 font-mono text-sm">
                    Sin registros · Agregá tu primer gasto
                  </td></tr>
                ) : items.map((item, i) => {
                  const overdue = isOverdue(item)
                  return (
                    <tr key={item.id}
                      className={cn('table-row animate-fade-in', overdue && 'bg-rose/5')}
                      style={{ animationDelay: `${i * 20}ms`, animationFillMode: 'both' }}>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleStatus(item)}
                          className={cn('inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full border transition-all duration-150',
                            item.status === 'PAGADO'
                              ? 'tag-positive hover:opacity-70'
                              : overdue
                                ? 'bg-rose/10 text-rose border-rose/30 hover:opacity-70'
                                : 'bg-amber/10 text-amber border-amber/30 hover:opacity-70')}>
                          {item.status === 'PAGADO'
                            ? <><CheckCircle className="w-3 h-3" /> PAGADO</>
                            : overdue
                              ? <><AlertCircle className="w-3 h-3" /> VENCIDO</>
                              : <><Clock className="w-3 h-3" /> PENDIENTE</>}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{formatDate(item.date)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{item.category}</td>
                      <td className="px-4 py-3 text-sm text-slate-400">{item.description ?? '—'}</td>
                      <td className="px-4 py-3 font-mono font-600 text-sm text-white">{formatUSD(item.amount_usd)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
