import type { PortfolioSummary } from '@/types'
import { formatNumber, formatPct } from '@/lib/utils'
import { SectionHead } from './ui'
import ValueChart from './ValueChart'

const tone = (n: number) => (n > 0 ? 'text-ok' : n < 0 ? 'text-danger' : 'text-ink')

export default function ValueSection({ summary }: { summary: PortfolioSummary }) {
  const invested = summary.total_invested + summary.cash.balance
  return (
    <section aria-labelledby="h-valor">
      <SectionHead id="h-valor" title="Valor de la cartera" action={{ href: '/statistics', label: 'Rendimiento' }} />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-1 pt-5">
        <strong className="font-serif text-[2rem] font-normal leading-[1.1] tracking-[-0.01em] tabular-nums max-[819px]:text-2xl">
          US$ {formatNumber(summary.total_market_value)}
        </strong>
        <span className={`font-medium tabular-nums ${tone(summary.day_pnl)}`}>
          {formatNumber(summary.day_pnl, { sign: true })} ({formatPct(summary.day_pnl_pct)}) <span className="font-normal text-ink-3">hoy</span>
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-4 border-b border-line pb-5 pt-3 max-[819px]:grid-cols-2">
        <div>
          <dt className="text-[13px] text-ink-3">Resultado abierto</dt>
          <dd className={`text-base font-medium tabular-nums ${tone(summary.open_pnl)}`}>
            {formatNumber(summary.open_pnl, { sign: true })}<small className="ml-1 text-[13px] font-normal">{formatPct(summary.open_pnl_pct)}</small>
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-3">Resultado realizado</dt>
          <dd className={`text-base font-medium tabular-nums ${tone(summary.realized_pnl)}`}>{formatNumber(summary.realized_pnl, { sign: true })}</dd>
        </div>
        <div className="max-[819px]:col-span-2">
          <dt className="text-[13px] text-ink-3">Capital invertido</dt>
          <dd className="text-base font-medium tabular-nums">{formatNumber(invested)}</dd>
        </div>
      </dl>
      <ValueChart />
    </section>
  )
}
