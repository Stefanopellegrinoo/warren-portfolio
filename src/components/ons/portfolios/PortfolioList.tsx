'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { fmtDate } from '@/lib/on-format'
import { SectionHead } from '@/components/resumen/ui'
import { api } from './api'
import { btnPrimary, btnQuiet, btnSecondary, field, label, Loading, LoadError, notice } from '../ui'

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

  if (failed) return <LoadError message="No se pudieron cargar tus carteras." onRetry={() => void load()} />
  if (!data) return <Loading label="Cargando carteras" />

  const full = data.portfolios.length >= data.limits.portfolios
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
      <section aria-labelledby="pl-new">
        <SectionHead id="pl-new" title={`Nueva cartera (${data.portfolios.length} de ${data.limits.portfolios})`} />
        <div className="pt-4">
        {full ? <p className={notice('warn')}>Llegaste al máximo de {data.limits.portfolios} carteras. Eliminá una para crear otra.</p> : (
          <form onSubmit={(e) => void create(e)} className="flex max-w-md items-end gap-2 max-[819px]:max-w-none">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="pl-name" className={label}>Nombre</label>
              <input id="pl-name" className={field} maxLength={60} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Ingreso mensual en dólares" />
            </div>
            <button type="submit" className={btnPrimary} disabled={busy || name.trim() === ''}>Crear</button>
          </form>
        )}
        <p aria-live="assertive" role={message ? 'alert' : undefined} className={message ? `mt-3 ${notice('danger')}` : 'sr-only'}>{message}</p>
        </div>
      </section>

      {data.portfolios.length === 0 ? (
        <p className="text-ink-2">Todavía no tenés carteras de prueba. Creá la primera para armar una combinación de ONs y ver su calendario de cobros.</p>
      ) : (
        <section aria-labelledby="pl-list">
        <SectionHead id="pl-list" title="Mis carteras de prueba" count={data.portfolios.length} />
        <ul aria-label="Mis carteras de prueba">
          {data.portfolios.map((p) => (
            <li key={p.id} className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <Link href={`/ons/carteras/${p.id}`} className="block truncate font-semibold text-ink hover:text-accent-ink hover:underline hover:underline-offset-2">{p.name}</Link>
                <p className="text-[13px] text-ink-3">{p.itemCount} {p.itemCount === 1 ? 'ON' : 'ONs'} · actualizada {fmtDate(p.updatedAt.slice(0, 10))}</p>
              </div>
              {confirming === p.id ? (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Confirmar eliminación de ${p.name}`}>
                  <span className="text-[13px] font-medium text-danger">¿Eliminar?</span>
                  <button type="button" className={`${btnSecondary} text-danger`} disabled={busy} onClick={() => void remove(p.id)}>Sí, eliminar</button>
                  <button type="button" className={btnQuiet} onClick={() => setConfirming(null)}>Cancelar</button>
                </div>
              ) : (
                <button type="button" className={btnQuiet} onClick={() => setConfirming(p.id)} aria-label={`Eliminar ${p.name}`}>Eliminar</button>
              )}
            </li>
          ))}
        </ul>
        </section>
      )}
    </div>
  )
}
