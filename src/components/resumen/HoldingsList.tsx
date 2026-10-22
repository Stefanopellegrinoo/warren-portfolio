import Link from 'next/link'
import type { HoldingRow } from '@/lib/resumen/holdings'
import { formatNumber, formatPct } from '@/lib/utils'
import { Chip, GroupHead, linkButton, toneOf } from './ui'

const rowGrid =
  'grid min-h-14 grid-cols-[56px_minmax(0,1fr)_auto_112px] items-center gap-x-3 border-b border-line py-2 last:border-b-0 ' +
  'max-[819px]:grid-cols-[48px_minmax(0,1fr)_auto] max-[819px]:gap-y-0.5'

function Holding({ r }: { r: HoldingRow }) {
  const weight = `${formatNumber(r.weightPct, { decimals: 1 })} % de la cartera`
  // Without a company name the quantity becomes the main line, so the ticker is not repeated.
  const title = r.name ?? r.quantityLabel
  const meta = r.name
    ? (r.value === null ? r.quantityLabel : `${r.quantityLabel}, ${weight}`)
    : (r.value === null ? 'Sin cotización' : weight)
  return (
    <li className={rowGrid}>
      <Link href={r.href} className="font-semibold text-ink hover:text-accent-ink max-[819px]:row-span-2 max-[819px]:self-start max-[819px]:pt-0.5" aria-label={`${r.ticker}${r.name ? `, ${r.name}` : ''}, ver detalle`}>
        {r.ticker}
      </Link>
      <span className="min-w-0">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-[13px] text-ink-3 max-[819px]:whitespace-normal">{meta}</span>
      </span>
      {r.dayChangePct === null
        ? <Chip tone="neutral" className="justify-self-end max-[819px]:col-start-2 max-[819px]:row-start-2 max-[819px]:justify-self-start">Sin precio hoy</Chip>
        : <Chip tone={toneOf(r.dayChangePct)} className="justify-self-end max-[819px]:col-start-2 max-[819px]:row-start-2 max-[819px]:justify-self-start">{formatPct(r.dayChangePct, { digits: 1 })} hoy</Chip>}
      <span className="text-right tabular-nums max-[819px]:col-start-3 max-[819px]:row-span-2 max-[819px]:row-start-1">
        <b className="block font-medium">{r.value === null ? '—' : formatNumber(r.value)}</b>
        {r.pnl !== null && (
          <small className={`text-[13px] ${r.pnl >= 0 ? 'text-ok' : 'text-danger'}`}>
            {/* Each part stays whole: peso amounts are long and used to break "%)" onto its own line. */}
            <span className="whitespace-nowrap">{formatNumber(r.pnl, { decimals: 0, sign: true })}</span>{' '}
            <span className="whitespace-nowrap">({formatPct(r.pnlPct, { digits: 1 })})</span>
          </small>
        )}
        {r.estimated && r.value !== null && <small className="block text-[13px] text-ink-3">estimado</small>}
      </span>
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
  const stocks = rows.filter(r => r.kind !== 'on')
  const ons = rows.filter(r => r.kind === 'on')
  return (
    <>
      {stocks.length > 0 && (
        <>
          <GroupHead>Acciones y CEDEARs <span className="tabular-nums">{stocks.length}</span></GroupHead>
          <ul>{stocks.map(r => <Holding key={r.ticker} r={r} />)}</ul>
        </>
      )}

      <GroupHead>Caja</GroupHead>
      <ul>
        <li className="grid min-h-14 grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-x-3 py-2 max-[819px]:grid-cols-[48px_minmax(0,1fr)_auto]">
          <span className="font-semibold">USD</span>
          <span className="min-w-0">
            <span className="block font-medium">Dólares disponibles</span>
            <span className="block text-[13px] text-ink-3">{formatNumber(cashWeightPct, { decimals: 1 })} % de la cartera{cashNote && `. ${cashNote}`}</span>
          </span>
          <span className="text-right tabular-nums">
            <b className="block font-medium">{formatNumber(cash)}</b>
            <button type="button" onClick={onAdjustCash} className={`${linkButton} text-[13px]`}>Ajustar saldo</button>
          </span>
        </li>
      </ul>

      <GroupHead>Obligaciones negociables{ons.length > 0 && <span className="tabular-nums">{ons.length}</span>}</GroupHead>
      {ons.length > 0
        ? <ul>{ons.map(r => <Holding key={r.ticker} r={r} />)}</ul>
        : <p className="py-2 text-[13px] text-ink-3">No tenés ONs. <Link href="/ons" className="text-accent-ink underline underline-offset-2">Explorar ONs</Link></p>}
    </>
  )
}
