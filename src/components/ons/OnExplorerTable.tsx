import Link from 'next/link'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OnListRow } from '@/lib/on-analytics'
import type { ExplorerState, SortKey } from '@/lib/on-explorer-filters'
import { lineLabel, eventLabel, fmtBp, fmtDate, fmtNum, fmtPct, fmtUsdCompact, rateTypeLabel, safeHref } from '@/lib/on-format'
import { btnSecondary, field, HEAD_ROW, label as labelCls, ScrollTable, TH as TH_BASE, TD as TD_BASE, tag, Tag } from './ui'

interface Props {
  rows: OnListRow[]
  sort: ExplorerState['sort']
  onSort: (key: SortKey) => void
}

// `long` names the column where there is no header to explain it (the phone sort control).
const COLUMNS: { key: SortKey; label: string; long: string; numeric: boolean; hint?: string }[] = [
  { key: 'ticker', label: 'Ticker', long: 'Ticker', numeric: false },
  { key: 'maturity', label: 'Vence', long: 'Vencimiento', numeric: false },
  { key: 'price', label: 'Precio', long: 'Precio', numeric: true, hint: 'Precio sucio de la línea D (data912), por 100 VN' },
  { key: 'ytm', label: 'TIR', long: 'TIR', numeric: true, hint: 'Tasa interna de retorno efectiva anual al vencimiento' },
  { key: 'md', label: 'MD', long: 'Duración modificada', numeric: true, hint: 'Duración modificada, en años' },
  { key: 'paridad', label: 'Paridad', long: 'Paridad', numeric: true, hint: 'Precio sucio sobre valor residual más intereses devengados' },
  { key: 'cy', label: 'TC', long: 'Tasa corriente', numeric: true, hint: 'Tasa corriente: cupón anual sobre precio limpio' },
  { key: 'wal', label: 'Vida', long: 'Vida promedio', numeric: true, hint: 'Vida promedio ponderada (WAL), en años' },
  { key: 'spread', label: 'Spread', long: 'Spread', numeric: true, hint: 'Opcional, referencial: TIR menos TIR soberana interpolada por duración' },
  { key: 'adtv', label: 'Vol. prom.', long: 'Volumen promedio', numeric: true, hint: 'Volumen diario promedio de 20 ruedas (suma de líneas O, D y C), en USD' },
]

const TH = cn(TH_BASE, 'pr-3 align-bottom')
const TD = cn(TD_BASE, 'pr-3 align-top')
// The first column stays in view while the table scrolls sideways; it repaints the row hover itself.
const STICKY = 'sticky left-0 z-10 bg-canvas shadow-[1px_0_0_var(--line)] group-hover:bg-hover'
const FLOATING_HINT = 'Tasa variable: no se proyectan los cupones, por eso no se calcula TIR ni se puede simular'

function sortAria(active: boolean, dir: 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  return active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
}

const NO_TRADES_HINT = 'La línea D no tuvo operaciones en la rueda: el precio es de referencia y la TIR puede no ser representativa.'

function PriceCell({ r }: { r: OnListRow }) {
  if (r.status === 'no-price') return <span className="text-ink-3">Sin precio</span>
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={r.priceQuality === 'no-trades' ? 'text-ink-2' : undefined}>{fmtNum(r.price)}</span>
      <span className="max-w-[7rem] whitespace-normal text-right text-xs leading-tight text-ink-3" title={r.lineFallback ? 'Precio de la otra línea en dólares: la de la plaza de pago no tiene precio.' : undefined}>{lineLabel(r.priceLine, r.cclUsed)}</span>
      {r.priceQuality === 'no-trades' && (
        <span title={NO_TRADES_HINT} className="max-w-[7rem] cursor-help whitespace-normal text-right text-xs leading-tight text-warn">
          sin operaciones en la rueda<span className="sr-only">: precio de referencia, la TIR puede no ser representativa</span>
        </span>
      )}
    </div>
  )
}

function YtmCell({ r }: { r: OnListRow }) {
  const f = r.methodFlag
  const n = r.termsNote
  return (
    <div className="flex flex-col items-end gap-0.5">
    <div className="flex items-center justify-end gap-1.5">
      {f && (
        <span
          role="note"
          title={`Cálculo no verificado: difiere de BYMA. BYMA ${fmtPct(f.bymaYtmPct)}, Warren ${fmtPct(f.methodYtmPct)} (${fmtBp(f.diffBp)}, control del ${fmtDate(f.asOf)}). Ninguno es definitivo.`}
          className="cursor-help text-sm text-warn"
        >
          <span aria-hidden>⚠</span>
          <span className="sr-only">Cálculo no verificado: BYMA {fmtPct(f.bymaYtmPct)}, Warren {fmtPct(f.methodYtmPct)}</span>
        </span>
      )}
      {!f && n && (
        <span
          role="note"
          title={`Con los términos de Warren la TIR es ${fmtPct(n.termsYtmPct)} y BYMA informa ${fmtPct(n.bymaYtmPct)} (${fmtBp(n.diffBp)}): difiere de BYMA por convención de cálculo de intereses. Es informativo.`}
          className="cursor-help text-xs text-ink-3"
        >
          <span aria-hidden>ⓘ</span> <span className="sr-only">difiere de BYMA por convención</span>
        </span>
      )}
      {r.shortDated && r.ytmPct !== null && (
        <span title="Vence en menos de 90 días: la TIR es muy sensible al precio y poco representativa." className={`${tag('neutral')} cursor-help`}>
          &lt;90 d
        </span>
      )}
      <span className="font-semibold">{r.priceQuality === 'no-trades' ? '—' : fmtPct(r.ytmPct)}</span>
    </div>
    {r.bymaYtm && (
      <div className="text-xs text-ink-3" title={`TIR de BYMA al ${fmtDate(r.bymaYtm.asOf)}: precio en pesos ÷ MEP. La de Warren usa el precio en dólares de la línea D.`}>
        BYMA {fmtPct(r.bymaYtm.pct)}
      </div>
    )}
    </div>
  )
}

function Badges({ r }: { r: OnListRow }) {
  return (
    <>
      {r.events.map((e) => {
        const href = safeHref(e.sourceUrl)
        const text = `${eventLabel(e.kind)} ${fmtDate(e.eventDate)}`
        const cls = cn(tag('info'), 'ml-1.5 align-middle')
        return href ? (
          <a key={`${e.kind}-${e.eventDate}`} href={href} target="_blank" rel="noopener noreferrer" title={e.note ?? `Evento corporativo: ${eventLabel(e.kind)}`} className={cn(cls, 'underline-offset-2 hover:underline')}>
            {text}
          </a>
        ) : (
          <span key={`${e.kind}-${e.eventDate}`} className={cls}>{text}</span>
        )
      })}
    </>
  )
}

/** Phones: one stacked row per ON (as the Resumen holdings), with the sort the table header gives on wider screens. */
function PhoneList({ rows, sort, onSort }: Props) {
  const asc = sort.dir === 'asc'
  return (
    <div className="grid gap-3 min-[820px]:hidden">
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="on-sort" className={labelCls}>Ordenar por</label>
          <select id="on-sort" className={field} value={sort.key} onChange={(e) => onSort(e.target.value as SortKey)}>
            {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.long}</option>)}
          </select>
        </div>
        <button type="button" onClick={() => onSort(sort.key)} className={btnSecondary} aria-label={asc ? 'Orden ascendente. Invertir' : 'Orden descendente. Invertir'}>
          {asc ? <ArrowUp aria-hidden className="h-4 w-4" strokeWidth={1.5} /> : <ArrowDown aria-hidden className="h-4 w-4" strokeWidth={1.5} />}
          {asc ? 'Menor a mayor' : 'Mayor a menor'}
        </button>
      </div>
      {rows.length === 0 ? <p className="py-10 text-center text-ink-3">Sin resultados</p> : (
        <ul aria-label="Obligaciones negociables" className="border-t border-line-strong">
          {rows.map((r) => (
            <li key={r.isin} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-line py-2 last:border-b-0">
              <div className="min-w-0">
                <div className="flex min-h-11 flex-wrap items-center gap-x-2">
                  <Link href={`/ons/${r.isin}`} className="font-semibold text-ink hover:text-accent-ink hover:underline hover:underline-offset-2">{r.tickerO}</Link>
                  <Badges r={r} />
                </div>
                <div className="truncate text-[13px] text-ink-2">{r.issuer ?? '—'}</div>
                <div className="text-xs text-ink-3">{r.currencyLabel} · {r.law} · {rateTypeLabel(r.rateType)}</div>
              </div>
              <div className="pt-3 text-right">
                <span className="text-xs text-ink-3">TIR</span>
                <YtmCell r={r} />
              </div>
              <p className="col-span-2 mt-1 text-[13px] tabular-nums text-ink-2">
                Vence {fmtDate(r.maturityDate)} · {r.status === 'no-price' ? 'Sin precio' : `Precio ${fmtNum(r.price)}`} · MD {fmtNum(r.mdYears)}
                {r.nextPayDate && <> · Próx. pago {fmtDate(r.nextPayDate)}</>}
              </p>
              {r.priceQuality === 'no-trades' && <p className="col-span-2 text-xs text-warn">Sin operaciones en la rueda: precio de referencia, la TIR puede no ser representativa.</p>}
              {r.rateType === 'floating' && <Tag tone="neutral" title={FLOATING_HINT} className="col-span-2 mt-1 justify-self-start">No simulable</Tag>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function OnExplorerTable({ rows, sort, onSort }: Props) {
  return (
    <>
    <div className="relative max-[819px]:hidden">
      <ScrollTable label="Tabla de ONs">
      <table className="w-full min-w-[1000px] border-collapse text-sm tabular-nums">
        <caption className="sr-only">Obligaciones negociables: precio, TIR y duración. Ordená por columna con el encabezado.</caption>
        <thead>
          <tr className={cn(HEAD_ROW, 'text-left')}>
            {COLUMNS.map((c) => {
              const active = sort.key === c.key
              return (
                <th key={c.key} scope="col" aria-sort={sortAria(active, sort.dir)} title={c.hint} className={cn(TH, c.numeric && 'text-right', c.key === 'ticker' && 'sticky left-0 z-10 bg-canvas')}>
                  <button type="button" onClick={() => onSort(c.key)} className={cn('inline-flex min-h-8 items-center gap-1 hover:text-ink', active && 'text-ink')}>
                    {c.label}
                    {active && (sort.dir === 'asc' ? <ArrowUp aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} /> : <ArrowDown aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />)}
                  </button>
                </th>
              )
            })}
            <th scope="col" className={TH}><span className="inline-flex min-h-8 items-center">Próx. pago</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length + 1} className="px-3 py-10 text-center text-ink-3">Sin resultados</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.isin} className="group border-b border-line last:border-b-0 hover:bg-hover">
                <th scope="row" className={cn(TD, STICKY, 'text-left font-normal')}>
                  <Link href={`/ons/${r.isin}`} className="font-semibold text-ink hover:text-accent-ink hover:underline hover:underline-offset-2">{r.tickerO}</Link>
                  <Badges r={r} />
                  <div className="max-w-[12rem] truncate text-[13px] text-ink-2" title={r.description ?? r.issuer ?? undefined}>{r.issuer ?? '—'}</div>
                  <div className="text-xs text-ink-3">{r.isin}</div>
                  <div className="text-xs text-ink-3">
                    {r.currencyLabel} · {r.law} · {rateTypeLabel(r.rateType)}
                  </div>
                  {r.rateType === 'floating' && (
                    <Tag tone="neutral" title={FLOATING_HINT} className="mt-1">No simulable</Tag>
                  )}
                </th>
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
                      <div>{fmtDate(r.nextPayDate)}</div>
                      <div className="text-xs text-ink-3">{fmtNum(r.nextPayAmountPct)}%</div>
                    </>
                  ) : '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </ScrollTable>
      {/* Right-edge fade while the table is wider than its box: it scrolls sideways. */}
      <div data-scroll-hint aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-canvas to-transparent min-[1344px]:hidden" />
    </div>
    <PhoneList rows={rows} sort={sort} onSort={onSort} />
    </>
  )
}
