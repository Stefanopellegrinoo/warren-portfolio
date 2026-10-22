import Link from 'next/link'
import type { HoldingRow } from '@/lib/resumen/holdings'
import { formatNumber, formatPct } from '@/lib/utils'
import { Chip, GroupHead, linkButton, toneOf } from './ui'

// Narrow: ticker | name over day chip | value over result.
// Wide (the list's own width, see cq-wide): one aligned column per figure, like a table.
const COLS = 'cq-wide:grid-cols-[64px_minmax(0,1fr)_104px_120px_160px_64px]'
const rowGrid =
  `grid min-h-14 grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-line py-2.5 last:border-b-0 cq-wide:gap-y-0 ${COLS}`
const valueCell = 'col-start-3 row-start-1 text-right tabular-nums cq-wide:col-start-4'
const resultCell = 'col-start-3 row-start-2 text-right text-[13px] tabular-nums cq-wide:col-start-5 cq-wide:row-start-1 cq-wide:text-sm'
const weightCell = 'hidden text-right text-[13px] tabular-nums text-ink-2 cq-wide:col-start-6 cq-wide:row-start-1 cq-wide:block'

function ColumnHeads() {
  return (
    <div aria-hidden="true" className={`hidden border-b border-line pb-2 pt-4 text-xs text-ink-3 cq-wide:grid cq-wide:gap-x-3 ${COLS}`}>
      <span className="col-span-2">Activo</span>
      <span className="text-right">Hoy</span>
      <span className="text-right">Valor</span>
      <span className="text-right">Resultado</span>
      <span className="text-right">Peso</span>
    </div>
  )
}

function Holding({ r }: { r: HoldingRow }) {
  const weight = `${formatNumber(r.weightPct, { decimals: 1 })} % de la cartera`
  // Without a company name the quantity becomes the main line, so the ticker is not repeated.
  const title = r.name ?? r.quantityLabel
  const meta = r.name
    ? (r.value === null ? r.quantityLabel : `${r.quantityLabel}, ${weight}`)
    : (r.value === null ? 'Sin cotización' : weight)
  // The wide row has its own weight column.
  const wideMeta = r.name ? r.quantityLabel : (r.value === null ? 'Sin cotización' : null)
  return (
    <li className={rowGrid}>
      <Link href={r.href} className="row-span-2 self-start pt-0.5 font-semibold text-ink hover:text-accent-ink cq-wide:row-span-1 cq-wide:self-center cq-wide:pt-0" aria-label={`${r.ticker}${r.name ? `, ${r.name}` : ''}, ver detalle`}>
        {r.ticker}
      </Link>
      <span className="col-start-2 row-start-1 min-w-0">
        <span className="block truncate font-medium">{title}</span>
        <span className="block text-[13px] text-ink-3 cq-wide:hidden">{meta}</span>
        {wideMeta && <span className="hidden truncate text-[13px] text-ink-3 cq-wide:block">{wideMeta}</span>}
      </span>
      {r.dayChangePct === null
        ? <Chip tone="neutral" className="col-start-2 row-start-2 justify-self-start cq-wide:col-start-3 cq-wide:row-start-1 cq-wide:justify-self-end">Sin precio hoy</Chip>
        : <Chip tone={toneOf(r.dayChangePct)} className="col-start-2 row-start-2 justify-self-start cq-wide:col-start-3 cq-wide:row-start-1 cq-wide:justify-self-end">{formatPct(r.dayChangePct, { digits: 1 })} hoy</Chip>}
      <span className={valueCell}>
        <b className="block font-semibold">{r.value === null ? '—' : formatNumber(r.value)}</b>
        {r.estimated && r.value !== null && <small className="block text-[13px] text-ink-3">estimado</small>}
      </span>
      {r.pnl !== null && (
        <span className={`${resultCell} ${r.pnl >= 0 ? 'text-ok' : 'text-danger'}`}>
          {/* Each part stays whole: peso amounts are long and used to break "%)" onto its own line. */}
          <span className="whitespace-nowrap">{formatNumber(r.pnl, { decimals: 0, sign: true })}</span>{' '}
          <span className="whitespace-nowrap">({formatPct(r.pnlPct, { digits: 1 })})</span>
        </span>
      )}
      <span className={weightCell}>{formatNumber(r.weightPct, { decimals: 1 })} %</span>
    </li>
  )
}

export default function HoldingsList({ rows, cash, cashWeightPct, cashNote, onAdjustCash }: {
  rows: HoldingRow[]
  cash: number
  cashWeightPct: number
  /** Why the balance reads as it does in the chosen currency. */
  cashNote?: string
  onAdjustCash: () => void
}) {
  const groups = [
    { title: 'Acciones', items: rows.filter(r => r.kind === 'stock') },
    { title: 'CEDEARs', items: rows.filter(r => r.kind === 'cedear') },
  ]
  const ons = rows.filter(r => r.kind === 'on')
  return (
    <div className="[container-type:inline-size]">
      <ColumnHeads />
      {groups.filter(g => g.items.length > 0).map(g => (
        <section key={g.title} aria-label={g.title}>
          <GroupHead>{g.title} <span className="tabular-nums">{g.items.length}</span></GroupHead>
          <ul>{g.items.map(r => <Holding key={r.ticker} r={r} />)}</ul>
        </section>
      ))}

      <GroupHead>Obligaciones negociables{ons.length > 0 && <span className="tabular-nums">{ons.length}</span>}</GroupHead>
      {ons.length > 0
        ? <ul>{ons.map(r => <Holding key={r.ticker} r={r} />)}</ul>
        : <p className="py-2 text-[13px] text-ink-3">No tenés ONs. <Link href="/ons" className="text-accent-ink underline underline-offset-2">Explorar ONs</Link></p>}

      <GroupHead>Caja</GroupHead>
      <ul>
        <li className={rowGrid}>
          <span className="row-span-2 self-start pt-0.5 font-semibold cq-wide:row-span-1 cq-wide:self-center cq-wide:pt-0">USD</span>
          <span className="col-start-2 row-start-1 min-w-0">
            <span className="block font-medium">Dólares disponibles</span>
            <span className="block text-[13px] text-ink-3">
              <span className="cq-wide:hidden">{formatNumber(cashWeightPct, { decimals: 1 })} % de la cartera{cashNote && '. '}</span>
              {cashNote}
            </span>
          </span>
          <span className={valueCell}><b className="block font-semibold">{formatNumber(cash)}</b></span>
          <span className={`${resultCell} cq-wide:text-[13px]`}>
            <button type="button" onClick={onAdjustCash} className={linkButton}>Ajustar saldo</button>
          </span>
          <span className={weightCell}>{formatNumber(cashWeightPct, { decimals: 1 })} %</span>
        </li>
      </ul>
    </div>
  )
}
