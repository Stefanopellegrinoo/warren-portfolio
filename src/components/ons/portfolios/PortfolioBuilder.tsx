'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OnListRow } from '@/lib/on-analytics'
import type { PortfolioAnalysis } from '@/lib/on-portfolio-analytics'
import { fmtDate, fmtNum, fmtVn } from '@/lib/on-format'
import { formatAge } from '@/lib/utils'
import { api } from './api'
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
const LABEL = 'text-[11px] font-mono uppercase tracking-widest text-slate-400'

// TODO(stage 6): "Comparar con mi cartera real" needs the real ON holdings as a read-only view
// (positions by ISIN, residual VN after amortizations); it is not cheap with today's code, so it
// ships with the real-portfolio stage and reuses analyzePortfolio on those holdings.

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
    <li className="rounded-xl border border-bg-600/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/ons/${item.isin}`} className="font-mono text-sm font-bold text-white hover:text-amber">{ticker}</Link>
          {row && row.tickerD && <span className="ml-1 font-mono text-[11px] text-slate-500">({row.tickerO})</span>}
          {matured && <span className="ml-2 rounded-full border border-amber/30 px-2 py-0.5 text-[11px] text-amber">vencida</span>}
          <span className="ml-2 text-xs text-slate-400">{row?.issuer ?? 'Emisor sin dato'}</span>
          <p className="mt-0.5 text-xs text-slate-300">
            {item.mode === 'usd' ? `USD ${fmtNum(item.amount)}` : fmtVn(item.amount)}
            {item.manualPrice !== null && ` · precio manual ${fmtNum(item.manualPrice)}`}
            {position && ` → ${fmtVn(position.vn)}, costo USD ${fmtNum(position.cost)}`}
          </p>
          {skipped && <p className="mt-0.5 text-xs text-amber">Fuera del cálculo: {skipped.message}</p>}
        </div>
        {!editing && !confirming && (
          <div className="flex gap-2">
            {!matured && <button type="button" className="btn-ghost" disabled={busy} onClick={startEdit} aria-label={`Editar ${ticker}`}>Editar</button>}
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirming(true)} aria-label={`Quitar ${ticker}`}>Quitar</button>
          </div>
        )}
        {confirming && (
          <div className="flex items-center gap-2" role="group" aria-label={`Confirmar quitar ${ticker}`}>
            <span className="text-xs text-amber">¿Quitar?</span>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void remove()}>Sí, quitar</button>
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        )}
      </div>
      {editing && (
        <div className="mt-3 space-y-3">
          <PortfolioItemFields idPrefix={`edit-${item.id}`} values={vals} onChange={setVals} marketPrice={row?.price} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>Guardar</button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setEditing(false)}>Cancelar</button>
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

  if (state === 'loading') return <div className="glass flex items-center justify-center rounded-2xl p-10"><div role="status" aria-label="Cargando cartera" className="h-6 w-6 animate-spin rounded-full border-2 border-amber/30 border-t-amber" /></div>
  if (state === 'missing') {
    return (
      <div className="glass space-y-3 rounded-2xl p-6" role="alert">
        <p className="text-sm text-slate-200">No encontramos esa cartera.</p>
        <Link href="/ons/carteras" className="btn-ghost inline-block">Volver a mis carteras</Link>
      </div>
    )
  }
  if (state === 'error' || !view) {
    return (
      <div className="glass flex flex-col items-start gap-3 rounded-2xl p-6" role="alert">
        <p className="text-sm text-rose">No se pudo cargar la cartera.</p>
        <button type="button" className="btn-ghost" onClick={() => { setState('loading'); void load() }}>Reintentar</button>
      </div>
    )
  }

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
    <div className="space-y-5">
      <Link href="/ons/carteras" className="inline-block text-sm text-slate-400 hover:text-white">← Mis carteras de prueba</Link>

      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">{view.portfolio.name}</h1>
        <p className="text-sm text-slate-400">Cartera hipotética: armala con montos de prueba y mirá cuánto cobrarías mes a mes. No toca tus tenencias reales.</p>
        <form onSubmit={(e) => void rename(e)} className="flex max-w-md items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="pf-name" className={LABEL}>Nombre</label>
            <input id="pf-name" className="input-field" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button type="submit" className="btn-ghost" disabled={busy || name.trim() === '' || name.trim() === view.portfolio.name}>Renombrar</button>
        </form>
      </header>

      <p aria-live="assertive" role={message ? 'alert' : undefined} className={message ? 'rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber' : 'sr-only'}>{message}</p>
      {view.stale && <div role="status" className="rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">Catálogo desactualizado: los datos de BYMA Educa son del {fmtDate(view.asOf)}.</div>}
      {!view.prices.ok && <div role="status" className="rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">Precios no disponibles en este momento (data912): las ONs sin precio manual quedan fuera del cálculo.</div>}

      <section className="glass space-y-4 rounded-2xl p-5" aria-labelledby="pf-add">
        <h2 id="pf-add" className="font-display text-sm font-bold uppercase tracking-widest text-slate-300">Agregar una ON ({view.items.length} de {view.limits.items})</h2>
        {full ? <p className="text-sm text-amber">Llegaste al máximo de {view.limits.items} ONs por cartera.</p> : (
          <form onSubmit={(e) => void add(e)} className="space-y-4">
            {picked ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-200">
                <span>ON elegida: <strong className="font-mono text-white">{picked.tickerD ?? picked.tickerO}</strong> · {picked.issuer ?? 'Emisor sin dato'}</span>
                <button type="button" className="btn-ghost" onClick={() => setPicked(null)}>Cambiar</button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label htmlFor="pf-search" className={LABEL}>Buscar ON (ticker, emisor o ISIN)</label>
                <input id="pf-search" className="input-field" type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} aria-describedby="pf-search-count" />
                <p id="pf-search-count" aria-live="polite" className="text-[11px] text-slate-400">
                  {catalog.length === 0 ? 'Cargando catálogo…' : query.trim().length < 2 ? `${candidates.length} ONs en dólares disponibles. Escribí al menos 2 letras.` : `${matches.length} resultado${matches.length === 1 ? '' : 's'}${matches.length === MAX_MATCHES ? ' (mostrando los primeros)' : ''}`}
                </p>
                {matches.length > 0 && (
                  <ul className="mt-1 divide-y divide-bg-600/60 rounded-xl border border-bg-600/60" aria-label="Resultados de la búsqueda">
                    {matches.map((r) => (
                      <li key={r.isin}>
                        <button type="button" disabled={taken.has(r.isin)} onClick={() => setPicked(r)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-50">
                          <span><span className="font-mono font-bold text-white">{r.tickerD ?? r.tickerO}</span> <span className="text-slate-400">{r.issuer ?? ''}</span></span>
                          <span className="shrink-0 text-xs text-slate-400">{taken.has(r.isin) ? 'Ya está en la cartera' : `vence ${fmtDate(r.maturityDate)}`}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <PortfolioItemFields idPrefix="add" values={vals} onChange={setVals} marketPrice={picked?.price} />
            <button type="submit" className="btn-primary" disabled={busy || !picked}>Agregar a la cartera</button>
          </form>
        )}
      </section>

      <section aria-labelledby="pf-items" className="space-y-3">
        <h2 id="pf-items" className="font-display text-sm font-bold uppercase tracking-widest text-slate-300">ONs de la cartera</h2>
        {view.items.length === 0 ? <p className="text-sm text-slate-400">Todavía no agregaste ninguna ON.</p> : (
          <ul className="space-y-2">
            {view.items.map((i) => <ItemRow key={i.id} item={i} row={byIsin.get(i.isin)} view={view} onChanged={refresh} onError={setMessage} />)}
          </ul>
        )}
      </section>

      <PortfolioResults analysis={view.analysis} />
      {view.prices.fetchedAt && <p className="text-[11px] font-mono text-slate-500">Precios de data912 ({formatAge(view.prices.fetchedAt)}) · términos de BYMA Educa al {fmtDate(view.asOf)}. Cálculo propio de Warren sobre precio sucio.</p>}
    </div>
  )
}
