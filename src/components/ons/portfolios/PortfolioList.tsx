'use client'

import Link from 'next/link'
import { useState } from 'react'
import { fmtDate } from '@/lib/on-format'
import { SectionHead } from '@/components/resumen/ui'
import { forgetCached, useCached } from '@/lib/client-cache'
import { api, apiData } from './api'
import { btnPrimary, btnQuiet, btnSecondary, field, label, Loading, LoadError, notice } from '../ui'

interface Item { id: string; name: string; itemCount: number; updatedAt: string }
interface Listing { portfolios: Item[]; limits: { portfolios: number; items: number } }

const ERROR = `mt-3 ${notice('danger')}`

/** Name field + Crear; `onCancel` only when the form was opened from the "Nueva cartera" button. */
function CreateForm({ onCancel }: { onCancel?: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const r = await api<{ portfolio: { id: string } }>('/api/test-portfolios', { method: 'POST', body: { name } })
    if (!r.ok) { setBusy(false); return setError(r.error) }
    window.location.assign(`/ons/carteras/${r.data.portfolio.id}`)
  }

  return (
    <div>
      <form onSubmit={(e) => void create(e)} className="flex max-w-xl flex-wrap items-end gap-2" aria-label="Nueva cartera">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5 max-[819px]:basis-full">
          <label htmlFor="pl-name" className={label}>Nombre de la cartera nueva</label>
          {/* Opened by a tap on "Nueva cartera": the field is what the user asked for. */}
          <input id="pl-name" className={field} maxLength={60} autoComplete="off" autoFocus={!!onCancel} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ej.: Ingreso mensual en dólares" aria-invalid={error ? true : undefined} aria-describedby={error ? 'pl-name-error' : undefined} />
        </div>
        <button type="submit" className={btnPrimary} disabled={busy || name.trim() === ''}>Crear</button>
        {onCancel && <button type="button" className={btnQuiet} disabled={busy} onClick={onCancel}>Cancelar</button>}
      </form>
      {error && <p id="pl-name-error" role="alert" className={ERROR}>{error}</p>}
    </div>
  )
}

function Row({ p, onDeleted }: { p: Item; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    const r = await api(`/api/test-portfolios/${p.id}`, { method: 'DELETE' })
    setBusy(false)
    setConfirming(false)
    if (!r.ok) return setError(r.error)
    onDeleted()
  }

  return (
    <li className="border-b border-line py-2.5 last:border-b-0">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <Link href={`/ons/carteras/${p.id}`} className="block truncate font-semibold text-ink hover:text-accent-ink hover:underline hover:underline-offset-2">{p.name}</Link>
          <p className="text-[13px] text-ink-3">{p.itemCount} {p.itemCount === 1 ? 'ON' : 'ONs'} · actualizada {fmtDate(p.updatedAt.slice(0, 10))}</p>
        </div>
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Confirmar eliminación de ${p.name}`}>
            <span className="text-[13px] font-medium text-danger">¿Eliminar la cartera?</span>
            <button type="button" className={`${btnSecondary} text-danger`} disabled={busy} onClick={() => void remove()}>Sí, eliminar</button>
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        ) : (
          <button type="button" className={btnQuiet} onClick={() => { setError(null); setConfirming(true) }} aria-label={`Eliminar ${p.name}`}>Eliminar</button>
        )}
      </div>
      {error && <p role="alert" className={ERROR}>{error}</p>}
    </li>
  )
}

export default function PortfolioList() {
  // The list seen before in this tab shows at once and refreshes behind (odd/tasks/rendimiento.md S9).
  const list = useCached('ons:test-portfolios', () => apiData<Listing>('/api/test-portfolios'))
  const [creating, setCreating] = useState(false)
  const data = list.data

  if (!data && list.error) return <LoadError message="No se pudieron cargar tus carteras de prueba." onRetry={list.reload} />
  if (!data) return <Loading label="Cargando carteras" />
  // A deleted portfolio leaves the list here, without asking for it again; its remembered view goes too.
  const deleted = (id: string) => {
    forgetCached(`ons:test-portfolio:${id}`)
    list.mutate({ ...data, portfolios: data.portfolios.filter((p) => p.id !== id) })
  }

  const { portfolios, limits } = data
  const full = portfolios.length >= limits.portfolios
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <p className="max-w-[72ch] text-ink-2">
        Una cartera de prueba sirve para simular una combinación de ONs antes de comprarlas: ves cuánto cobrarías, cuándo y cuánto rinde. No toca tus tenencias reales.
      </p>

      {portfolios.length === 0 ? (
        <section aria-labelledby="pl-new">
          <SectionHead id="pl-new" title="Creá tu primera cartera" />
          <div className="pt-4"><CreateForm /></div>
        </section>
      ) : (
        <section aria-labelledby="pl-list">
          <SectionHead id="pl-list" title="Mis carteras de prueba" count={portfolios.length} />
          <ul aria-label="Mis carteras de prueba">
            {portfolios.map((p) => <Row key={p.id} p={p} onDeleted={() => deleted(p.id)} />)}
          </ul>
          <div className="mt-4 border-t border-line pt-4">
            {full ? <p className={notice('warn')}>Llegaste al máximo de {limits.portfolios} carteras. Eliminá una para crear otra.</p>
              : creating ? <CreateForm onCancel={() => setCreating(false)} />
              : <button type="button" className={`${btnSecondary} max-[819px]:w-full`} onClick={() => setCreating(true)}>Nueva cartera</button>}
          </div>
        </section>
      )}
    </div>
  )
}
