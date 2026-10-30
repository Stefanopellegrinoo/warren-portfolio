'use client'

import { useEffect, useId, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import type { AssetPage } from '@/lib/fundamentals/service'
import { METRICS, type MetricId } from '@/lib/fundamentals/catalog'
import { explain, formatMetric, nullReason, shortName, type Known } from '@/lib/fundamentals/explain'
import { fetchTickerSearch, shouldFetchSearch } from '@/components/trading/chart/ticker-search'
import { requestErrorMessage } from '@/lib/request-errors'
import type { SearchResult } from '@/lib/market-data/types'
import { field } from '@/components/ons/ui'
import { cn } from '@/lib/utils'
import { peerName } from '../numeros/HistoryPanel'

/** The design's Comparar ratios (odd/tasks/asset-page.md S9), with the short names their columns carry. */
const COLUMNS: { id: MetricId; label: string }[] = [
  { id: 'pe', label: 'P/E' },
  { id: 'peForward', label: 'P/E esperado' },
  { id: 'revenueGrowth', label: 'Crecimiento de ventas' },
  { id: 'netMargin', label: 'Margen neto' },
  { id: 'roe', label: 'ROE' },
  { id: 'debtToEquity', label: 'Deuda / patrimonio' },
  { id: 'marketCap', label: 'Capitalización' },
]
const MAX_PEERS = 5
const DEBOUNCE_MS = 300

type Better = 'higher' | 'lower' | null
const betterOf = (id: MetricId): Better => {
  const def = METRICS.find((d) => d.id === id)!
  return 'better' in def ? def.better ?? null : null
}
const unitOf = (id: MetricId) => METRICS.find((d) => d.id === id)!.unit

// As service.ts's parseTicker (server only): GGAL.BA → BCBA:GGAL. Anything else is never written:
// one bad ?vs= entry makes the whole page a 400.
const TICKER = /^(BCBA:)?[A-Z0-9][A-Z0-9.-]{0,14}$/
function toVs(symbol: string): string | null {
  const t = symbol.trim().toUpperCase().replace(/^([A-Z0-9-]+)\.BA$/, 'BCBA:$1')
  return TICKER.test(t) ? t : null
}
/** A peer's ticker as ?vs= takes it: NASDAQ:AMZN → AMZN; a BYMA share keeps BCBA:. */
const vsOf = (tvSymbol: string) => (tvSymbol.startsWith('BCBA:') ? tvSymbol : tvSymbol.slice(tvSymbol.indexOf(':') + 1))

interface Company {
  key: string
  name: string
  ticker: string
  own: boolean
  values: Record<MetricId, number | null>
  /** What nullReason reads for this company: a peer has its today's values only. */
  known: Known
}

/** Best first: lower first where lower is better; the largest first for a size (no better side). */
function ranked(rows: Company[], id: MetricId): Company[] {
  const sign = betterOf(id) === 'lower' ? 1 : -1
  return rows.filter((r) => r.values[id] !== null).sort((a, b) => sign * (a.values[id]! - b.values[id]!))
}

/**
 * The "Comparar" tab (odd/tasks/asset-page.md T7, S9): the company and its peers on the design's
 * ratios, sortable, with each column's best value and where the company stands. Facts only. The peer
 * set lives in ?vs= (at most 5) and applies to the whole page: the page reloads its data with it.
 */
export function ComparaTab({ page }: { page: AssetPage }) {
  const router = useRouter()
  const edited = useSearchParams().has('vs')
  const [sort, setSort] = useState<{ id: MetricId; dir: 1 | -1 } | null>(null)
  const [tip, setTip] = useState<MetricId | null>(null)
  const [adding, setAdding] = useState(false)
  // The page an edit was made on: until the next one arrives, the comparison is being updated.
  const [editedOn, setEditedOn] = useState<AssetPage | null>(null)
  const tipId = useId()

  const name = shortName(page.name)
  const peers = page.peers.map((p) => vsOf(p.tvSymbol))
  const companies: Company[] = [
    {
      key: page.ticker, name, ticker: page.ticker, own: true, known: page,
      values: Object.fromEntries(METRICS.map((d) => [d.id, page.metrics?.[d.id].today ?? null])) as Company['values'],
    },
    ...page.peers.map((p, i) => ({
      key: p.tvSymbol, name: peerName(p), ticker: peers[i], own: false, values: p.today,
      known: { metrics: Object.fromEntries(METRICS.map((d) => [d.id, { today: p.today[d.id] }])), sources: {} },
    })),
  ]
  const order = sort ? ranked(companies, sort.id) : companies
  if (sort) {
    if (sort.dir !== (betterOf(sort.id) === 'lower' ? 1 : -1)) order.reverse()
    order.push(...companies.filter((c) => c.values[sort.id] === null))
  }
  const standings = Object.fromEntries(COLUMNS.map(({ id }) => [id, ranked(companies, id)])) as Record<MetricId, Company[]>

  /** Writes ?vs= (null drops it) and keeps the rest of the URL; the route reloads the page's data. */
  function write(list: string[] | null) {
    const q = new URLSearchParams(window.location.search)
    if (list) q.set('vs', list.slice(0, MAX_PEERS).join(','))
    else q.delete('vs')
    const s = q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':')
    setEditedOn(page)
    router.replace(`${window.location.pathname}${s ? `?${s}` : ''}`, { scroll: false })
  }

  function sortBy(id: MetricId) {
    const first = betterOf(id) === 'lower' ? 1 : -1
    setSort(sort?.id === id ? { id, dir: sort.dir === 1 ? -1 : 1 } : { id, dir: first })
  }

  const tipCol = COLUMNS.find((c) => c.id === tip)
  const e = tip && explain(tip, name, companies[0].values[tip], 'USD')

  return (
    <div className="grid gap-4">
      <p className="max-w-prose text-sm leading-relaxed text-ink-2">
        Datos de hoy de {name} y de empresas parecidas, montos en dólares. Tocá el nombre de una columna para ordenar;
        el &quot;?&quot; explica cada dato y &quot;mejor&quot; marca el valor más favorable de cada uno.
      </p>

      <div className="grid gap-2">
        <p className="text-[15px] font-medium">Comparando con</p>
        <ul className="flex flex-wrap items-center gap-2">
          {page.peers.map((p, i) => (
            <li key={p.tvSymbol} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface pl-4 text-[15px]">
              {peerName(p)}
              <button
                type="button"
                aria-label={`Quitar ${peerName(p)}`}
                onClick={() => write(peers.filter((_, j) => j !== i))}
                className="grid h-11 w-11 place-items-center rounded-full text-ink-2 hover:bg-hover hover:text-ink"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              disabled={peers.length >= MAX_PEERS}
              aria-expanded={adding}
              onClick={() => setAdding(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-4 text-[15px] font-medium text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Agregar empresa
            </button>
          </li>
          {edited && (
            <li>
              <button type="button" onClick={() => write(null)} className="min-h-11 px-1 text-[15px] font-medium text-accent-ink underline-offset-2 hover:underline">
                Volver a las parecidas sugeridas
              </button>
            </li>
          )}
        </ul>
        {page.peers.length === 0 && <p className="text-[15px] text-ink-2">Todavía no hay empresas para comparar: agregá alguna.</p>}
        {peers.length >= MAX_PEERS && <p className="text-[15px] text-ink-2">Hasta 5 empresas: quitá una para sumar otra.</p>}
        {adding && peers.length < MAX_PEERS && (
          <AddPeer taken={[page.ticker, ...peers]} onPick={(t) => { setAdding(false); write([...peers, t]) }} onClose={() => setAdding(false)} />
        )}
        {editedOn === page && <p role="status" className="text-[15px] text-ink-2">Actualizando la comparación…</p>}
      </div>

      {tipCol && e && (
        <div id={tipId} className="max-w-prose rounded-md bg-ink p-3 text-[15px] leading-normal text-canvas">
          <p>
            <b>¿Qué es {tipCol.label}?</b> {e.what} {e.example ?? `${nullReason(tipCol.id, page)}.`} <b>{e.read}</b>
          </p>
        </div>
      )}

      {/* On a phone the table scrolls inside this box, never the page, with the company column pinned. */}
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left align-bottom font-semibold shadow-[1px_0_0_var(--line)]">
                Empresa
              </th>
              {COLUMNS.map(({ id, label }) => (
                <th
                  key={id}
                  scope="col"
                  aria-sort={sort?.id === id ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  className="px-2 py-1 text-right align-bottom font-semibold last:pr-4"
                >
                  <span className="inline-flex items-end justify-end gap-1">
                    <button
                      type="button"
                      aria-label={`Ordenar por ${label}`}
                      onClick={() => sortBy(id)}
                      className="min-h-11 max-w-[8rem] text-right leading-tight hover:text-accent-ink"
                    >
                      {label}
                      {sort?.id === id && <span aria-hidden="true">{sort.dir === 1 ? ' ↑' : ' ↓'}</span>}
                    </button>
                    <button
                      type="button"
                      aria-label={`Qué es ${label}`}
                      aria-expanded={tip === id}
                      aria-controls={tipId}
                      onClick={() => setTip(tip === id ? null : id)}
                      // 18 px drawn, 44 px to tap, as in Números.
                      className="relative mb-3 inline-grid h-[18px] w-[18px] flex-none place-items-center rounded-full bg-surface-2 font-mono text-[11px] font-semibold leading-none text-ink-2 before:absolute before:-inset-[13px] before:content-[''] hover:bg-hover hover:text-ink aria-expanded:bg-ink aria-expanded:text-canvas"
                    >
                      ?
                    </button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((c) => (
              <tr key={c.key} aria-current={c.own || undefined} className={cn('border-t border-line', c.own && 'bg-accent-soft')}>
                <th
                  scope="row"
                  className={cn(
                    'sticky left-0 z-10 min-w-[7.5rem] max-w-[11rem] px-3 py-2 text-left align-top font-normal',
                    c.own ? 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent),1px_0_0_var(--line)]' : 'bg-surface shadow-[1px_0_0_var(--line)]',
                  )}
                >
                  <span className="block font-medium leading-snug">{c.name}</span>
                  <span className="block font-mono text-[13px] text-ink-2">{c.ticker}</span>
                </th>
                {COLUMNS.map(({ id }) => (
                  <Cell key={id} company={c} id={id} standing={standings[id]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** One value: "mejor" on the column's best, the company's place in it, "—" with its reason. */
function Cell({ company, id, standing }: { company: Company; id: MetricId; standing: Company[] }) {
  const [why, setWhy] = useState(false)
  const value = company.values[id]
  if (value === null) {
    const reason = nullReason(id, company.known)
    return (
      <td className="px-2 py-2 text-right align-top last:pr-4">
        <button
          type="button"
          title={reason}
          aria-label={`Sin dato: ${reason}`}
          aria-expanded={why}
          onClick={() => setWhy(!why)}
          // On the values' line, 44 px to tap.
          className="inline-flex min-h-11 min-w-11 items-start justify-end font-mono leading-7 text-ink-2 hover:text-ink"
        >
          —
        </button>
        {why && <span className="ml-auto block max-w-[9rem] text-[13px] leading-snug text-ink-2">{reason}</span>}
      </td>
    )
  }
  const better = betterOf(id)
  const rank = standing.indexOf(company) + 1
  const best = better !== null && standing.length > 1 && value === standing[0].values[id]
  // The company's place: by its better side, or by size where there is none (Capitalización).
  const place = company.own && standing.length > 1 && !best
    ? better ? `${rank}.º de ${standing.length}` : rank === 1 ? 'la más grande' : `${rank}.ª más grande`
    : null
  return (
    <td className="whitespace-nowrap px-2 py-2 text-right align-top last:pr-4">
      <span className={cn('block font-mono leading-7', (best || company.own) && 'font-semibold')}>{formatMetric(value, unitOf(id))}</span>
      {best && <span className="block text-[13px] font-medium text-ok">mejor</span>}
      {place && <span className="block text-[13px] text-ink-2">{place}</span>}
    </td>
  )
}

/** "+ Agregar empresa": the market search (shared with the chart and the shell), companies only. */
function AddPeer({ taken, onPick, onClose }: { taken: string[]; onPick: (ticker: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ q: string; results: SearchResult[]; error?: string } | null>(null)
  const q = query.trim()

  useEffect(() => {
    if (!shouldFetchSearch(q)) return
    let live = true
    const timer = setTimeout(() => {
      fetchTickerSearch(q).then(
        (results) => { if (live) setFound({ q, results }) },
        (err) => { if (live) setFound({ q, results: [], error: requestErrorMessage(err, 'No se pudo buscar. Probá de nuevo.') }) },
      )
    }, DEBOUNCE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [q])

  const answer = found?.q === q ? found : null
  const hits = (answer?.results ?? []).flatMap((r) => {
    const t = toVs(r.symbol)
    return (r.quoteType ?? 'EQUITY') === 'EQUITY' && t && !taken.includes(t) ? [{ ...r, ticker: t }] : []
  })
  const status = answer?.error ?? (hits.length ? null
    : !shouldFetchSearch(q) ? 'Escribí un ticker o un nombre.'
    : answer ? 'No hay empresas que coincidan.' : 'Buscando…')

  return (
    <div className="grid max-w-md gap-2 rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          onKeyDown={(ev) => ev.key === 'Escape' && onClose()}
          aria-label="Buscar una empresa para comparar"
          placeholder="Ticker o nombre: AMZN, Galicia…"
          autoComplete="off"
          spellCheck={false}
          className={cn(field, 'min-h-11 flex-1 text-[15px]')}
        />
        <button type="button" onClick={onClose} className="min-h-11 px-2 text-[15px] font-medium text-ink-2 hover:text-ink">
          Cancelar
        </button>
      </div>
      {hits.length > 0 && (
        <ul aria-label="Empresas encontradas" className="grid">
          {hits.map((h) => (
            <li key={h.symbol}>
              <button type="button" onClick={() => onPick(h.ticker)} className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-[15px] hover:bg-hover">
                <span className="w-24 flex-none truncate font-mono font-semibold">{h.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2">{h.shortname}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {status && <p role="status" className={cn('text-[15px]', answer?.error ? 'text-danger' : 'text-ink-2')}>{status}</p>}
    </div>
  )
}
