'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { OnListRow } from '@/lib/on-analytics'
import type { PortfolioAnalysis } from '@/lib/on-portfolio-analytics'
import { fmtDate, fmtNum, fmtVn } from '@/lib/on-format'
import { formatAge } from '@/lib/utils'
import { SectionHead } from '@/components/resumen/ui'
import { api } from './api'
import { BackLink, btnPrimary, btnQuiet, btnSecondary, field, Glossary, hint, label, Loading, LoadError, Notice, notice, Tag, type GlossaryTerm } from '../ui'
import PortfolioItemFields, { parseFields, toFieldText, type ItemFieldValues } from './PortfolioItemFields'
import { PortfolioDetails, PortfolioSummary } from './PortfolioResults'

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
const WARN_TEXT = 'text-[13px] text-warn'
const DONE_LINE = 'mt-3 text-[13px] font-medium text-ok'
const GLOSSARY: GlossaryTerm[] = ['TIR', 'Duración', 'Vida promedio', 'Valor nominal (VN)', 'Lámina mínima', 'Precio sucio y limpio', 'Amortización', 'Plaza de pago']

/** odd/tasks/ux-ons-y-operaciones.md S5: every error is shown, and announced, next to the action that caused it. */
function ErrorText({ id, message }: { id?: string; message: string | null }) {
  return message ? <p id={id} role="alert" className={`mt-3 ${notice('danger')}`}>{message}</p> : null
}

/** The lot refusal arrives as a bare "Mínimo: VN 1.000"; say what it means. */
const plain = (message: string) => (message.startsWith('Mínimo: ') ? `Con ese monto no llegás a la compra mínima de esta ON: ${message.slice(8)} (la lámina mínima).` : message)
/** A warning without its leading "TICKER: ", since it shows under that ON's own row. */
const own = (message: string) => plain(message.replace(/^\S+: /, ''))

function Title({ portfolio, onRenamed }: { portfolio: View['portfolio']; onRenamed: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(portfolio.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = () => { setName(portfolio.name); setError(null); setOpen(true) }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim() === portfolio.name) return setOpen(false)
    setBusy(true)
    const r = await api(`/api/test-portfolios/${portfolio.id}`, { method: 'PATCH', body: { name } })
    setBusy(false)
    if (!r.ok) return setError(plain(r.error))
    setOpen(false)
    await onRenamed()
  }

  return (
    <header>
      <BackLink href="/ons/carteras">Mis carteras de prueba</BackLink>
      {open ? (
        <>
          <h1 className="sr-only">{portfolio.name}</h1>
          <form onSubmit={(e) => void submit(e)} className="flex max-w-xl flex-wrap items-end gap-2">
            <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5 max-[819px]:basis-full">
              <label htmlFor="pf-name" className={label}>Nombre de la cartera</label>
              <input id="pf-name" className={field} maxLength={60} autoComplete="off" autoFocus value={name} onChange={(e) => setName(e.target.value)}
                aria-invalid={error ? true : undefined} aria-describedby={error ? 'pf-name-error' : undefined} />
            </div>
            <button type="submit" className={btnPrimary} disabled={busy || name.trim() === ''}>Guardar</button>
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
          </form>
          <ErrorText id="pf-name-error" message={error} />
        </>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-4">
          <h1 className="min-w-0 break-words font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl">{portfolio.name}</h1>
          <button type="button" onClick={start} className="inline-flex min-h-6 items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink max-[819px]:min-h-11">
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />Renombrar
          </button>
        </div>
      )}
      <p className="mt-1 max-w-[72ch] text-ink-3">Cartera hipotética para probar antes de comprar: no toca tus tenencias reales.</p>
    </header>
  )
}

function ItemRow({ item, row, view, onChanged }: { item: SavedItem; row?: OnListRow; view: View; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [vals, setVals] = useState<ItemFieldValues>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const position = view.analysis.positions.find((p) => p.isin === item.isin)
  const skipped = view.analysis.skipped.find((s) => s.isin === item.isin)
  const warnings = skipped ? [] : view.analysis.warnings.filter((w) => w.isin === item.isin)
  const ticker = position?.tickerO ?? row?.tickerO ?? item.isin // the explorer's ticker (O line)
  const matured = skipped?.reason === 'no-payments'
  const url = `/api/test-portfolios/${view.portfolio.id}/items/${item.id}`
  const input = item.mode === 'usd' ? `USD ${fmtNum(item.amount)}` : fmtVn(item.amount)

  const startEdit = () => { setVals({ mode: item.mode, amount: toFieldText(item.amount), price: toFieldText(item.manualPrice) }); setError(null); setSaved(false); setEditing(true) }
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const p = parseFields(vals)
    if (!p.ok) return setError(p.error)
    setBusy(true)
    const r = await api(url, { method: 'PATCH', body: { mode: p.mode, amount: p.amount, manualPrice: p.manualPrice } })
    setBusy(false)
    if (!r.ok) return setError(plain(r.error))
    setError(null); setEditing(false); setSaved(true)
    await onChanged()
  }
  const remove = async () => {
    setBusy(true)
    const r = await api(url, { method: 'DELETE' })
    setBusy(false)
    setConfirming(false)
    if (!r.ok) return setError(plain(r.error))
    await onChanged()
  }

  return (
    <li className="border-b border-line py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <Link href={`/ons/${item.isin}`} className="font-semibold text-ink hover:text-accent-ink hover:underline hover:underline-offset-2">{ticker}</Link>
            {matured && <Tag tone="warn" className="self-center">vencida</Tag>}
            <span className="min-w-0 text-[13px] text-ink-2">{position?.issuer ?? row?.issuer ?? 'Emisor sin dato'}</span>
          </div>
          <p className="mt-0.5 text-[13px] tabular-nums text-ink-2">
            {position ? (item.mode === 'usd' ? `Con ${input} comprás ${fmtVn(position.vn)} por USD ${fmtNum(position.cost)}` : `${fmtVn(position.vn)} por USD ${fmtNum(position.cost)}`) : input}
            {item.manualPrice !== null && ` · precio manual ${fmtNum(item.manualPrice)}`}
          </p>
          {skipped && <p className={`mt-1 ${WARN_TEXT}`}>Fuera del cálculo. {own(skipped.message)}</p>}
          {warnings.map((w, i) => <p key={`${w.kind}-${i}`} className={`mt-1 ${WARN_TEXT}`}>Aviso: {own(w.message)}</p>)}
          {saved && !editing && <p role="status" className="mt-1 text-[13px] font-medium text-ok">Cambios guardados.</p>}
        </div>
        {!editing && !confirming && (
          <div className="flex gap-1">
            {!matured && <button type="button" className={btnQuiet} disabled={busy} onClick={startEdit} aria-label={`Editar ${ticker}`}>Editar</button>}
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => { setError(null); setConfirming(true) }} aria-label={`Quitar ${ticker}`}>Quitar</button>
          </div>
        )}
        {confirming && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Confirmar quitar ${ticker}`}>
            <span className="text-[13px] font-medium text-danger">¿Quitar {ticker}?</span>
            <button type="button" className={`${btnSecondary} text-danger`} disabled={busy} onClick={() => void remove()}>Sí, quitar</button>
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        )}
      </div>
      {editing && (
        <form onSubmit={(e) => void save(e)} className="mt-3 grid gap-3" aria-label={`Editar ${ticker}`}>
          <PortfolioItemFields idPrefix={`edit-${item.id}`} values={vals} onChange={setVals} marketPrice={row?.price} />
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={busy}>Guardar</button>
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => { setError(null); setEditing(false) }}>Cancelar</button>
          </div>
        </form>
      )}
      <ErrorText message={error} />
    </li>
  )
}

function AddItemForm({ portfolioId, catalog, catalogError, onRetryCatalog, taken, count, limit, first, onAdded }: {
  portfolioId: string
  catalog: OnListRow[] | null
  catalogError: string | null
  onRetryCatalog: () => void
  taken: Set<string>
  count: number
  limit: number
  first: boolean
  onAdded: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<OnListRow | null>(null)
  const [vals, setVals] = useState<ItemFieldValues>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)

  const candidates = useMemo(() => (catalog ?? []).filter((r) => r.currency === 'USD' && r.rateType !== 'floating'), [catalog])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return candidates.filter((r) => [r.tickerO, r.tickerD ?? '', r.issuer ?? '', r.isin, r.description ?? ''].some((s) => s.toLowerCase().includes(q))).slice(0, MAX_MATCHES)
  }, [candidates, query])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdded(null)
    if (!picked) return setError('Elegí una ON de los resultados de la búsqueda')
    const p = parseFields(vals)
    if (!p.ok) return setError(p.error)
    setBusy(true)
    const r = await api(`/api/test-portfolios/${portfolioId}/items`, { method: 'POST', body: { isin: picked.isin, mode: p.mode, amount: p.amount, manualPrice: p.manualPrice } })
    setBusy(false)
    if (!r.ok) return setError(plain(r.error))
    setError(null); setAdded(picked.tickerO); setPicked(null); setQuery(''); setVals(EMPTY)
    await onAdded()
  }

  const searchHint = catalog === null ? 'Cargando catálogo…'
    : query.trim().length < 2 ? `${candidates.length} ONs en dólares disponibles. Escribí al menos 2 letras.`
    : `${matches.length} resultado${matches.length === 1 ? '' : 's'}${matches.length === MAX_MATCHES ? ' (mostrando los primeros)' : ''}`

  return (
    <section aria-labelledby="pf-add">
      <SectionHead id="pf-add" title={first ? 'Agregá la primera ON' : 'Agregar una ON'} action={<span className="text-[13px] text-ink-3">{count} de {limit}</span>} />
      <div className="pt-4">
        {first && <p className="mb-4 max-w-[72ch] text-ink-2">Buscala por ticker, emisor o ISIN y poné cuánto comprarías: vas a ver cuánto cobrarías, cuándo y cuánto rinde.</p>}
        {count >= limit ? <p className={notice('warn')}>Llegaste al máximo de {limit} ONs por cartera. Quitá una para agregar otra.</p>
          : catalogError ? <LoadError message={catalogError} onRetry={onRetryCatalog} /> : (
          <form onSubmit={(e) => void submit(e)} className="grid gap-4">
            {picked ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>ON elegida: <strong className="font-semibold">{picked.tickerO}</strong> · <span className="text-ink-2">{picked.issuer ?? 'Emisor sin dato'}</span></span>
                <button type="button" className={btnQuiet} onClick={() => setPicked(null)}>Cambiar</button>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pf-search" className={label}>Buscar ON (ticker, emisor o ISIN)</label>
                <input id="pf-search" className={field} type="search" autoComplete="off" value={query} onChange={(e) => { setQuery(e.target.value); setAdded(null) }} aria-describedby="pf-search-count" />
                <p id="pf-search-count" aria-live="polite" className={hint}>{searchHint}</p>
                {matches.length > 0 && (
                  <ul className="mt-1 divide-y divide-line rounded-md border border-line bg-surface" aria-label="Resultados de la búsqueda">
                    {matches.map((r) => (
                      <li key={r.isin}>
                        <button type="button" disabled={taken.has(r.isin)} onClick={() => { setPicked(r); setError(null) }} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 px-3 py-2 text-left hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-transparent">
                          <span className="min-w-0"><span className="font-semibold">{r.tickerO}</span> <span className="text-ink-2">{r.issuer ?? ''}</span></span>
                          <span className="shrink-0 text-[13px] text-ink-3">{taken.has(r.isin) ? 'Ya está en la cartera' : `vence ${fmtDate(r.maturityDate)}`}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <PortfolioItemFields idPrefix="add" values={vals} onChange={setVals} marketPrice={picked?.price} />
            <div>
              <button type="submit" className={`${btnPrimary} max-[819px]:w-full`} disabled={busy || !picked}>Agregar a la cartera</button>
              <ErrorText message={error} />
              {added && <p role="status" className={DONE_LINE}>Agregaste {added}: el resultado de arriba ya la incluye.</p>}
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

function Result({ analysis: a }: { analysis: PortfolioAnalysis }) {
  const out = a.skipped.length
  return (
    <section aria-labelledby="pf-result">
      <SectionHead id="pf-result" title="Resultado de la cartera" />
      {a.empty ? <p className={`mt-4 ${notice('warn')}`}>Ninguna de las ONs se puede simular: el motivo está en cada una, en la lista de abajo.</p> : (
        <>
          <PortfolioSummary analysis={a} />
          {out > 0 && <p className={`mt-3 ${WARN_TEXT}`}>{out === 1 ? 'Una ON queda' : `${out} ONs quedan`} fuera del cálculo: el motivo está en la lista de abajo.</p>}
        </>
      )}
    </section>
  )
}

export default function PortfolioBuilder({ id }: { id: string }) {
  const [view, setView] = useState<View | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading')
  const [catalog, setCatalog] = useState<OnListRow[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api<View>(`/api/test-portfolios/${id}`)
    if (!r.ok) return setState(r.status === 404 || r.status === 400 ? 'missing' : 'error')
    setView(r.data)
    setState('ok')
  }, [id])
  const loadCatalog = useCallback(async () => {
    setCatalogError(null)
    const r = await api<{ rows: OnListRow[] }>('/api/ons')
    if (r.ok) return setCatalog(r.data.rows)
    setCatalogError(`No se pudo cargar el catálogo de ONs, así que por ahora no podés buscar una ON para agregar. ${r.status === 0 ? r.error : 'Probá de nuevo en un momento.'}`)
  }, [])
  useEffect(() => { void load(); void loadCatalog() }, [load, loadCatalog])

  const byIsin = useMemo(() => new Map((catalog ?? []).map((r) => [r.isin, r])), [catalog])

  if (state === 'loading') return <Loading label="Cargando cartera" />
  if (state === 'missing') {
    return (
      <div className="grid justify-items-start gap-3 py-8" role="alert">
        <p className="text-ink-2">No encontramos esa cartera. Puede que la hayas eliminado.</p>
        <Link href="/ons/carteras" className={btnSecondary}>Volver a mis carteras</Link>
      </div>
    )
  }
  if (state === 'error' || !view) return <LoadError message="No se pudo cargar la cartera." onRetry={() => { setState('loading'); void load() }} />

  // An empty portfolio starts with the add form; the fixed child order keeps the form's state when the first ON lands.
  const empty = view.items.length === 0
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
      <Title portfolio={view.portfolio} onRenamed={load} />

      {(view.stale || !view.prices.ok) && (
        <div className="-mt-6 grid gap-2">
          {view.stale && <Notice>Catálogo desactualizado: los datos de BYMA Educa son del {fmtDate(view.asOf)}.</Notice>}
          {!view.prices.ok && <Notice>Precios no disponibles en este momento (data912): las ONs sin precio manual quedan fuera del cálculo.</Notice>}
        </div>
      )}

      {!empty && <Result analysis={view.analysis} />}
      {!empty && (
        <section aria-labelledby="pf-items">
          <SectionHead id="pf-items" title="ONs de la cartera" count={view.items.length} />
          <ul aria-label="ONs de la cartera">
            {view.items.map((i) => <ItemRow key={i.id} item={i} row={byIsin.get(i.isin)} view={view} onChanged={load} />)}
          </ul>
        </section>
      )}
      <AddItemForm portfolioId={id} catalog={catalog} catalogError={catalogError} onRetryCatalog={() => void loadCatalog()}
        taken={new Set(view.items.map((i) => i.isin))} count={view.items.length} limit={view.limits.items} first={empty} onAdded={load} />
      {!empty && !view.analysis.empty && <PortfolioDetails analysis={view.analysis} />}

      <div className="grid gap-4">
        {view.prices.fetchedAt && <p className="text-[13px] text-ink-3">Precios de data912 ({formatAge(view.prices.fetchedAt)}) · términos de BYMA Educa al {fmtDate(view.asOf)}. Cálculo propio de Warren sobre precio sucio.</p>}
        <Glossary terms={GLOSSARY} />
      </div>
    </div>
  )
}
