'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { fmtDate } from '@/lib/on-format'
import { api } from './api'

interface Item { id: string; name: string; itemCount: number; updatedAt: string }
interface Listing { portfolios: Item[]; limits: { portfolios: number; items: number } }

export default function PortfolioList() {
  const [data, setData] = useState<Listing | null>(null)
  const [failed, setFailed] = useState(false)
  const [name, setName] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await api<Listing>('/api/test-portfolios')
    if (!r.ok) return setFailed(true)
    setFailed(false)
    setData(r.data)
  }, [])
  useEffect(() => { void load() }, [load])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const r = await api<{ portfolio: { id: string } }>('/api/test-portfolios', { method: 'POST', body: { name } })
    setBusy(false)
    if (!r.ok) return setMessage(r.error)
    window.location.assign(`/ons/carteras/${r.data.portfolio.id}`)
  }
  const remove = async (id: string) => {
    setBusy(true)
    const r = await api(`/api/test-portfolios/${id}`, { method: 'DELETE' })
    setBusy(false)
    setConfirming(null)
    if (!r.ok) return setMessage(r.error)
    setMessage(null)
    await load()
  }

  if (failed) {
    return (
      <div className="glass flex flex-col items-start gap-3 rounded-2xl p-6" role="alert">
        <p className="text-sm text-rose">No se pudieron cargar tus carteras.</p>
        <button type="button" className="btn-ghost" onClick={() => void load()}>Reintentar</button>
      </div>
    )
  }
  if (!data) return <div className="glass flex items-center justify-center rounded-2xl p-10"><div role="status" aria-label="Cargando carteras" className="h-6 w-6 animate-spin rounded-full border-2 border-amber/30 border-t-amber" /></div>

  const full = data.portfolios.length >= data.limits.portfolios
  return (
    <div className="space-y-5">
      <section className="glass rounded-2xl p-5" aria-labelledby="pl-new">
        <h2 id="pl-new" className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-slate-300">Nueva cartera ({data.portfolios.length} de {data.limits.portfolios})</h2>
        {full ? <p className="text-sm text-amber">Llegaste al máximo de {data.limits.portfolios} carteras. Eliminá una para crear otra.</p> : (
          <form onSubmit={(e) => void create(e)} className="flex max-w-md items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="pl-name" className="text-[11px] font-mono uppercase tracking-widest text-slate-400">Nombre</label>
              <input id="pl-name" className="input-field" maxLength={60} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Ingreso mensual en dólares" />
            </div>
            <button type="submit" className="btn-primary" disabled={busy || name.trim() === ''}>Crear</button>
          </form>
        )}
        <p aria-live="assertive" role={message ? 'alert' : undefined} className={message ? 'mt-3 text-sm text-amber' : 'sr-only'}>{message}</p>
      </section>

      {data.portfolios.length === 0 ? (
        <p className="text-sm text-slate-400">Todavía no tenés carteras de prueba. Creá la primera para armar una combinación de ONs y ver su calendario de cobros.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Mis carteras de prueba">
          {data.portfolios.map((p) => (
            <li key={p.id} className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
              <div className="min-w-0">
                <Link href={`/ons/carteras/${p.id}`} className="block truncate font-display text-base font-bold text-white hover:text-amber">{p.name}</Link>
                <p className="text-xs text-slate-400">{p.itemCount} {p.itemCount === 1 ? 'ON' : 'ONs'} · actualizada {fmtDate(p.updatedAt.slice(0, 10))}</p>
              </div>
              {confirming === p.id ? (
                <div className="flex items-center gap-2" role="group" aria-label={`Confirmar eliminación de ${p.name}`}>
                  <span className="text-xs text-amber">¿Eliminar?</span>
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void remove(p.id)}>Sí, eliminar</button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirming(null)}>Cancelar</button>
                </div>
              ) : (
                <button type="button" className="btn-ghost" onClick={() => setConfirming(p.id)} aria-label={`Eliminar ${p.name}`}>Eliminar</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
