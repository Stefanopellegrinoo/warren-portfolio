'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OnListRow } from '@/lib/on-analytics'
import type { PortfolioAnalysis } from '@/lib/on-portfolio-analytics'
import { fmtDate, fmtNum, fmtVn } from '@/lib/on-format'
import { formatAge } from '@/lib/utils'
import { SectionHead } from '@/components/resumen/ui'
import { api } from './api'
import { BackLink, btnPrimary, btnQuiet, btnSecondary, field, hint, label, Loading, LoadError, Notice, notice, Tag } from '../ui'
import PortfolioItemFields, { parseFields, toFieldText, type ItemFieldValues } from './PortfolioItemFields'
import PortfolioResults from './PortfolioResults'

interface SavedItem { id: string; isin: string; mode: 'usd' | 'vn'; amount: number; manualPrice: number | null }
interface View {
  portfolio: { id: string; name: string }
  items: SavedItem[]
  analysis: PortfolioAnalysis
  asOf: string | null
  stale: boolean
  prices: { ok: boolean; fetchedAt: string | null }
  limits: { portfolios: number; items: number }
}

const MAX_MATCHES = 8
const EMPTY: ItemFieldValues = { mode: 'usd', amount: '', price: '' }
const LABEL = label

function ItemRow({ item, row, view, onChanged, onError }: { item: SavedItem; row?: OnListRow; view: View; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [vals, setVals] = useState<ItemFieldValues>(EMPTY)
  const position = view.analysis.positions.find((p) => p.isin === item.isin)
  const skipped = view.analysis.skipped.find((s) => s.isin === item.isin)
  const ticker = position?.ticker ?? row?.tickerD ?? row?.tickerO ?? item.isin
  const matured = skipped?.reason === 'no-payments'
  const [confirming, setConfirming] = useState(false)

  const startEdit = () => { setVals({ mode: item.mode, amount: toFieldText(item.amount), price: toFieldText(item.manualPrice) }); setEditing(true) }
  const save = async () => {
    const p = parseFields(vals)
    if (!p.ok) return onError(p.error)
    setBusy(true)
    const r = await api(`/api/test-portfolios/${view.portfolio.id}/items/${item.id}`, { method: 'PATCH', body: { mode: p.mode, amount: p.amount, manualPrice: p.manualPrice } })
    setBusy(false)
    if (!r.ok) return onError(r.error)
    setEditing(false)
    await onChanged()
  }
  const remove = async () => {
    setBusy(true)
    const r = await api(`/api/test-portfolios/${view.portfolio.id}/items/${item.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!r.ok) return onError(r.error)
    await onChanged()
  }

  return (
    <li className="border-b border-line py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <Link href={`/ons/${item.isin}`} className="font-semibold text-ink hover:text-accent-ink hover:underline hover:underline-offset-2">{ticker}</Link>
          {row && row.tickerD && <span className="ml-1 text-[13px] text-ink-3">({row.tickerO})</span>}
          {matured && <Tag tone="warn" className="ml-2 align-middle">vencida</Tag>}
          <span className="ml-2 text-[13px] text-ink-2">{row?.issuer ?? 'Emisor sin dato'}</span>
          <p className="mt-0.5 text-[13px] tabular-nums text-ink-2">
            {item.mode === 'usd' ? `USD ${fmtNum(item.amount)}` : fmtVn(item.amount)}
            {item.manualPrice !== null && ` · precio manual ${fmtNum(item.manualPrice)}`}
            {position && ` → ${fmtVn(position.vn)}, costo USD ${fmtNum(position.cost)}`}
          </p>
          {skipped && <p className="mt-0.5 text-[13px] text-warn">Fuera del cálculo: {skipped.message}</p>}
        </div>
        {!editing && !confirming && (
          <div className="flex gap-1">
            {!matured && <button type="button" className={btnQuiet} disabled={busy} onClick={startEdit} aria-label={`Editar ${ticker}`}>Editar</button>}
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => setConfirming(true)} aria-label={`Quitar ${ticker}`}>Quitar</button>
          </div>
        )}
        {confirming && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Confirmar quitar ${ticker}`}>
            <span className="text-[13px] font-medium text-danger">¿Quitar?</span>
            <button type="button" className={`${btnSecondary} text-danger`} disabled={busy} onClick={() => void remove()}>Sí, quitar</button>
            <button type="button" className={btnQuiet} onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        )}
      </div>
      {editing && (
        <div className="mt-3 grid gap-3">
          <PortfolioItemFields idPrefix={`edit-${item.id}`} values={vals} onChange={setVals} marketPrice={row?.price} />
          <div className="flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>Guardar</button>
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </li>
  )
}

export default function PortfolioBuilder({ id }: { id: string }) {
  const [view, setView] = useState<View | null>(null)
  const [catalog, setCatalog] = useState<OnListRow[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<OnListRow | null>(null)
  const [vals, setVals] = useState<ItemFieldValues>(EMPTY)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await api<View>(`/api/test-portfolios/${id}`)
    if (!r.ok) return setState(r.status === 404 || r.status === 400 ? 'missing' : 'error')
    setView(r.data)
    setName(r.data.portfolio.name)
    setState('ok')
  }, [id])
  useEffect(() => {
    void load()
    void api<{ rows: OnListRow[] }>('/api/ons').then((r) => r.ok && setCatalog(r.data.rows))
  }, [load])

  const byIsin = useMemo(() => new Map(catalog.map((r) => [r.isin, r])), [catalog])
  const candidates = useMemo(() => catalog.filter((r) => r.currency === 'USD' && r.rateType !== 'floating'), [catalog])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return candidates.filter((r) => [r.tickerO, r.issuer ?? '', r.isin, r.description ?? ''].some((s) => s.toLowerCase().includes(q))).slice(0, MAX_MATCHES)
  }, [candidates, query])

  if (state === 'loading') return <Loading label="Cargando cartera" />
  if (state === 'missing') {
    return (
      <div className="grid justify-items-start gap-3 py-8" role="alert">
        <p className="text-ink-2">No encontramos esa cartera.</p>
        <Link href="/ons/carteras" className={btnSecondary}>Volver a mis carteras</Link>
      </div>
    )
  }
  if (state === 'error' || !view) return <LoadError message="No se pudo cargar la cartera." onRetry={() => { setState('loading'); void load() }} />

  const full = view.items.length >= view.limits.items
  const taken = new Set(view.items.map((i) => i.isin))
  const refresh = async () => { setMessage(null); await load() }

  const rename = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const r = await api(`/api/test-portfolios/${id}`, { method: 'PATCH', body: { name } })
    setBusy(false)
    if (!r.ok) return setMessage(r.error)
    await refresh()
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!picked) return setMessage('Elegí una ON del catálogo')
    const p = parseFields(vals)
    if (!p.ok) return setMessage(p.error)
    setBusy(true)
    const r = await api(`/api/test-portfolios/${id}/items`, { method: 'POST', body: { isin: picked.isin, mode: p.mode, amount: p.amount, manualPrice: p.manualPrice } })
    setBusy(false)
    if (!r.ok) return setMessage(r.error)
    setPicked(null); setQuery(''); setVals(EMPTY)
    await refresh()
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
      <header>
        <BackLink href="/ons/carteras">Mis carteras de prueba</BackLink>
        <h1 className="break-words font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl">{view.portfolio.name}</h1>
        <p className="mt-1 max-w-[72ch] text-ink-3">Cartera hipotética: armala con montos de prueba y mirá cuánto cobrarías mes a mes. No toca tus tenencias reales.</p>
        <form onSubmit={(e) => void rename(e)} className="mt-5 flex max-w-md items-end gap-2 max-[819px]:max-w-none">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor="pf-name" className={LABEL}>Nombre</label>
            <input id="pf-name" className={field} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button type="submit" className={btnSecondary} disabled={busy || name.trim() === '' || name.trim() === view.portfolio.name}>Renombrar</button>
        </form>
        <p aria-live="assertive" role={message ? 'alert' : undefined} className={message ? `mt-4 ${notice('danger')}` : 'sr-only'}>{message}</p>
      </header>

      {(view.stale || !view.prices.ok) && (
      <div className="-mt-6 grid gap-2">
      {view.stale && <Notice>Catálogo desactualizado: los datos de BYMA Educa son del {fmtDate(view.asOf)}.</Notice>}
      {!view.prices.ok && <Notice>Precios no disponibles en este momento (data912): las ONs sin precio manual quedan fuera del cálculo.</Notice>}
      </div>
      )}

      <section aria-labelledby="pf-add">
        <SectionHead id="pf-add" title={`Agregar una ON (${view.items.length} de ${view.limits.items})`} />
        <div className="pt-4">
        {full ? <p className={notice('warn')}>Llegaste al máximo de {view.limits.items} ONs por cartera.</p> : (
          <form onSubmit={(e) => void add(e)} className="grid gap-4">
            {picked ? (
              <div className="flex flex-wrap items-center gap-3">
                <span>ON elegida: <strong className="font-semibold">{picked.tickerD ?? picked.tickerO}</strong> · <span className="text-ink-2">{picked.issuer ?? 'Emisor sin dato'}</span></span>
                <button type="button" className={btnQuiet} onClick={() => setPicked(null)}>Cambiar</button>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pf-search" className={LABEL}>Buscar ON (ticker, emisor o ISIN)</label>
                <input id="pf-search" className={field} type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} aria-describedby="pf-search-count" />
                <p id="pf-search-count" aria-live="polite" className={hint}>
                  {catalog.length === 0 ? 'Cargando catálogo…' : query.trim().length < 2 ? `${candidates.length} ONs en dólares disponibles. Escribí al menos 2 letras.` : `${matches.length} resultado${matches.length === 1 ? '' : 's'}${matches.length === MAX_MATCHES ? ' (mostrando los primeros)' : ''}`}
                </p>
                {matches.length > 0 && (
                  <ul className="mt-1 divide-y divide-line rounded-md border border-line bg-surface" aria-label="Resultados de la búsqueda">
                    {matches.map((r) => (
                      <li key={r.isin}>
                        <button type="button" disabled={taken.has(r.isin)} onClick={() => setPicked(r)} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 px-3 py-2 text-left hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-transparent">
                          <span className="min-w-0"><span className="font-semibold">{r.tickerD ?? r.tickerO}</span> <span className="text-ink-2">{r.issuer ?? ''}</span></span>
                          <span className="shrink-0 text-[13px] text-ink-3">{taken.has(r.isin) ? 'Ya está en la cartera' : `vence ${fmtDate(r.maturityDate)}`}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <PortfolioItemFields idPrefix="add" values={vals} onChange={setVals} marketPrice={picked?.price} />
            <div><button type="submit" className={`${btnPrimary} max-[819px]:w-full`} disabled={busy || !picked}>Agregar a la cartera</button></div>
          </form>
        )}
        </div>
      </section>

      <section aria-labelledby="pf-items">
        <SectionHead id="pf-items" title="ONs de la cartera" count={view.items.length} />
        {view.items.length === 0 ? <p className="py-4 text-ink-3">Todavía no agregaste ninguna ON.</p> : (
          <ul>
            {view.items.map((i) => <ItemRow key={i.id} item={i} row={byIsin.get(i.isin)} view={view} onChanged={refresh} onError={setMessage} />)}
          </ul>
        )}
      </section>

      <PortfolioResults analysis={view.analysis} />
      {view.prices.fetchedAt && <p className="text-[13px] text-ink-3">Precios de data912 ({formatAge(view.prices.fetchedAt)}) · términos de BYMA Educa al {fmtDate(view.asOf)}. Cálculo propio de Warren sobre precio sucio.</p>}
    </div>
  )
}
