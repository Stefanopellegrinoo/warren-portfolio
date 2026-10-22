import { formatNumber, formatPct } from '@/lib/utils'
import type { Headline } from '@/lib/resumen/currency'
import { SectionHead } from './ui'
import ValueChart from './ValueChart'

const tone = (n: number) => (n > 0 ? 'text-ok' : n < 0 ? 'text-danger' : 'text-ink')

export default function ValueSection({ figures: f, notes = [] }: { figures: Headline; notes?: string[] }) {
  return (
    <section aria-labelledby="h-valor">
      <SectionHead id="h-valor" title="Valor de la cartera" action={{ href: '/statistics', label: 'Rendimiento' }} />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-1 pt-5">
        <strong className="font-serif text-[2rem] font-normal leading-[1.1] tracking-[-0.01em] tabular-nums max-[819px]:text-2xl">
          {f.prefix} {formatNumber(f.total)}
        </strong>
        <span className={`font-medium tabular-nums ${tone(f.dayPnl)}`}>
          {formatNumber(f.dayPnl, { sign: true })} <span className="whitespace-nowrap">({formatPct(f.dayPnlPct)})</span> <span className="font-normal text-ink-3">{f.dayLabel}</span>
        </span>
      </div>
      <dl className={`grid grid-cols-3 gap-4 pb-5 pt-3 max-[819px]:grid-cols-2 ${notes.length ? '' : 'border-b border-line'}`}>
        <div>
          <dt className="text-[13px] text-ink-3">Resultado abierto</dt>
          <dd className={`text-base font-medium tabular-nums ${tone(f.openPnl)}`}>
            {formatNumber(f.openPnl, { sign: true })}<small className="ml-1 whitespace-nowrap text-[13px] font-normal">{formatPct(f.openPnlPct)}</small>
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-3">{f.realizedLabel}</dt>
          <dd className={`text-base font-medium tabular-nums ${tone(f.realized)}`}>{formatNumber(f.realized, { sign: true })}</dd>
        </div>
        <div className="max-[819px]:col-span-2">
          <dt className="text-[13px] text-ink-3">Capital invertido</dt>
          <dd className="text-base font-medium tabular-nums">{formatNumber(f.capital)}</dd>
        </div>
      </dl>
      {notes.length > 0 && (
        <div className="grid gap-1 border-b border-line pb-4 text-[13px] text-ink-3">
          {notes.map(n => <p key={n}>{n}</p>)}
        </div>
      )}
      <ValueChart />
    </section>
  )
}
