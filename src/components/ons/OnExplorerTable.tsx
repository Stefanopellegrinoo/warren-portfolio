import Link from 'next/link'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OnListRow } from '@/lib/on-analytics'
import type { ExplorerState, SortKey } from '@/lib/on-explorer-filters'
import { eventLabel, fmtBp, fmtDate, fmtNum, fmtPct, fmtUsdCompact, rateTypeLabel, safeHref } from '@/lib/on-format'

interface Props {
  rows: OnListRow[]
  sort: ExplorerState['sort']
  onSort: (key: SortKey) => void
}

const COLUMNS: { key: SortKey; label: string; numeric: boolean; hint?: string }[] = [
  { key: 'ticker', label: 'Ticker', numeric: false },
  { key: 'issuer', label: 'Emisor', numeric: false },
  { key: 'maturity', label: 'Vence', numeric: false },
  { key: 'price', label: 'Precio', numeric: true, hint: 'Precio sucio de la línea D (data912), por 100 VN' },
  { key: 'ytm', label: 'TIR', numeric: true, hint: 'Tasa interna de retorno efectiva anual al vencimiento' },
  { key: 'md', label: 'MD', numeric: true, hint: 'Duración modificada, en años' },
  { key: 'paridad', label: 'Paridad', numeric: true, hint: 'Precio sucio sobre valor residual más intereses devengados' },
  { key: 'cy', label: 'TC', numeric: true, hint: 'Tasa corriente: cupón anual sobre precio limpio' },
  { key: 'wal', label: 'Vida', numeric: true, hint: 'Vida promedio ponderada (WAL), en años' },
  { key: 'spread', label: 'Spread', numeric: true, hint: 'Opcional, referencial: TIR menos TIR soberana interpolada por duración' },
  { key: 'adtv', label: 'Vol. prom.', numeric: true, hint: 'Volumen diario promedio de 20 ruedas (suma de líneas O, D y C), en USD' },
]

const TH = 'px-2 py-2.5 text-[10px] font-mono uppercase tracking-widest text-slate-400 whitespace-nowrap'
const TD = 'px-2 py-2.5 whitespace-nowrap'
const FLOATING_HINT = 'Tasa variable: no se proyectan los cupones, por eso no se calcula TIR ni se puede simular'

function sortAria(active: boolean, dir: 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  return active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
}

const NO_TRADES_HINT = 'La línea D no tuvo operaciones hoy: el precio es de referencia y la TIR puede no ser representativa.'

function PriceCell({ r }: { r: OnListRow }) {
  if (r.status === 'no-price') return <span className="italic text-slate-500">Sin precio</span>
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={r.priceQuality === 'no-trades' ? 'opacity-50' : undefined}>{fmtNum(r.price)}</span>
      {r.priceQuality === 'no-trades' && (
        <span title={NO_TRADES_HINT} className="cursor-help rounded border border-slate-500/40 px-1 text-[9px] leading-4 text-slate-300">
          sin operaciones hoy<span className="sr-only">: precio de referencia, la TIR puede no ser representativa</span>
        </span>
      )}
    </div>
  )
}

function YtmCell({ r }: { r: OnListRow }) {
  const f = r.methodFlag
  const n = r.termsNote
  return (
    <div className="flex items-center justify-end gap-1.5">
      {f && (
        <span
          role="note"
          title={`Cálculo no verificado: difiere de BYMA. BYMA ${fmtPct(f.bymaYtmPct)}, Warren ${fmtPct(f.methodYtmPct)} (${fmtBp(f.diffBp)}, control del ${fmtDate(f.asOf)}). Ninguno es definitivo.`}
          className="cursor-help text-xs text-amber"
        >
          <span aria-hidden>⚠</span>
          <span className="sr-only">Cálculo no verificado: BYMA {fmtPct(f.bymaYtmPct)}, Warren {fmtPct(f.methodYtmPct)}</span>
        </span>
      )}
      {!f && n && (
        <span
          role="note"
          title={`Con los términos de Warren la TIR es ${fmtPct(n.termsYtmPct)} y BYMA informa ${fmtPct(n.bymaYtmPct)} (${fmtBp(n.diffBp)}): difiere de BYMA por convención de cálculo de intereses. Es informativo.`}
          className="cursor-help text-[10px] text-slate-500"
        >
          <span aria-hidden>ⓘ</span> <span className="sr-only">difiere de BYMA por convención</span>
        </span>
      )}
      {r.shortDated && r.ytmPct !== null && (
        <span title="Vence en menos de 90 días: la TIR es muy sensible al precio y poco representativa." className="rounded border border-slate-500/40 px-1 text-[9px] leading-4 text-slate-300">
          &lt;90 d
        </span>
      )}
      <span
        title={r.bymaYtm ? `TIR BYMA ${fmtPct(r.bymaYtm.pct)} al ${fmtDate(r.bymaYtm.asOf)} (precio en pesos ÷ MEP); la de Warren usa el precio en dólares de la línea D.` : undefined}
        className={cn('font-semibold text-white', r.priceQuality === 'no-trades' && 'opacity-50')}
      >
        {fmtPct(r.ytmPct)}
      </span>
    </div>
  )
}

function Badges({ r }: { r: OnListRow }) {
  return (
    <>
      {r.events.map((e) => {
        const href = safeHref(e.sourceUrl)
        const text = `${eventLabel(e.kind)} ${fmtDate(e.eventDate)}`
        const cls = 'ml-1.5 rounded-full border border-sky/30 bg-sky/10 px-1.5 py-0.5 text-[9px] leading-none text-sky'
        return href ? (
          <a key={`${e.kind}-${e.eventDate}`} href={href} target="_blank" rel="noopener noreferrer" title={e.note ?? `Evento corporativo: ${eventLabel(e.kind)}`} className={cls}>
            {text}
          </a>
        ) : (
          <span key={`${e.kind}-${e.eventDate}`} className={cls}>{text}</span>
        )
      })}
    </>
  )
}

export default function OnExplorerTable({ rows, sort, onSort }: Props) {
  return (
    <div className="glass relative rounded-2xl">
      <div className="overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[1000px] text-sm font-mono">
        <caption className="sr-only">Obligaciones negociables: precio, TIR y duración. Ordená por columna con el encabezado.</caption>
        <thead>
          <tr className="border-b border-bg-600/60 text-left">
            {COLUMNS.map((c) => {
              const active = sort.key === c.key
              return (
                <th key={c.key} scope="col" aria-sort={sortAria(active, sort.dir)} title={c.hint} className={cn(TH, c.numeric && 'text-right', c.key === 'ticker' && 'sticky left-0 z-10 bg-bg-800')}>
                  <button type="button" onClick={() => onSort(c.key)} className={cn('inline-flex items-center gap-1 uppercase tracking-widest hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-amber', active && 'text-amber')}>
                    {c.label}
                    {active && (sort.dir === 'asc' ? <ArrowUp aria-hidden className="h-3 w-3" /> : <ArrowDown aria-hidden className="h-3 w-3" />)}
                  </button>
                </th>
              )
            })}
            <th scope="col" className={TH}>Próx. pago</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length + 1} className="px-3 py-10 text-center text-slate-400">Sin resultados</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.isin} className="table-row">
                <td className={cn(TD, 'sticky left-0 z-10 bg-bg-800')}>
                  <Link href={`/ons/${r.isin}`} className="font-semibold text-amber hover:underline">{r.tickerO}</Link>
                  <Badges r={r} />
                  <div className="text-[10px] text-slate-500">{r.isin}</div>
                  <div className="text-[10px] text-slate-400">
                    {r.currencyLabel} · {r.law} · {rateTypeLabel(r.rateType)}
                    {r.rateType === 'floating' && (
                      <span title={FLOATING_HINT} className="ml-1.5 cursor-help rounded-full border border-slate-500/30 bg-slate-500/10 px-1.5 py-0.5 text-[9px] leading-none text-slate-400">No simulable</span>
                    )}
                  </div>
                </td>
                <td className={cn(TD, 'max-w-[6.5rem] truncate text-slate-300')} title={r.description ?? r.issuer ?? undefined}>{r.issuer ?? '—'}</td>
                <td className={TD}>{fmtDate(r.maturityDate)}</td>
                <td className={cn(TD, 'text-right')}><PriceCell r={r} /></td>
                <td className={cn(TD, 'text-right')}><YtmCell r={r} /></td>
                <td className={cn(TD, 'text-right')}>{fmtNum(r.mdYears)}</td>
                <td className={cn(TD, 'text-right')}>{fmtPct(r.paridadPct)}</td>
                <td className={cn(TD, 'text-right')}>{fmtPct(r.currentYieldPct)}</td>
                <td className={cn(TD, 'text-right')}>{fmtNum(r.walYears)}</td>
                <td className={cn(TD, 'text-right')}>{fmtBp(r.spreadBp)}</td>
                <td className={cn(TD, 'text-right')}>{fmtUsdCompact(r.adtvUsd)}</td>
                <td className={TD}>
                  {r.nextPayDate ? (
                    <>
                      {fmtDate(r.nextPayDate)}
                      <span className="ml-1.5 text-[10px] text-slate-500">{fmtNum(r.nextPayAmountPct)}%</span>
                    </>
                  ) : '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
      {/* Right-edge fade: the table scrolls horizontally. */}
      <div data-scroll-hint aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-2xl bg-gradient-to-l from-bg-900/90 to-transparent" />
    </div>
  )
}
