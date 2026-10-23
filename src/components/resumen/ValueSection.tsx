import { TrendingDown, TrendingUp } from 'lucide-react'
import { formatNumber, formatPct } from '@/lib/utils'
import type { Headline } from '@/lib/resumen/currency'

const tone = (n: number) => (n > 0 ? 'text-ok' : n < 0 ? 'text-danger' : 'text-ink')

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums leading-tight">{children}</dd>
    </div>
  )
}

/** The answer to "how much do I have and how did today go", above everything else. */
export default function ValueSection({ figures: f }: { figures: Headline }) {
  const DayIcon = f.dayPnl < 0 ? TrendingDown : TrendingUp
  return (
    <section aria-labelledby="h-valor" className="rounded-lg border border-line bg-surface p-5 lg:p-6">
      <div className="grid gap-6 min-[1180px]:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)] min-[1180px]:items-end">
        <div className="min-w-0">
          <h2 id="h-valor" className="text-[13px] font-medium text-ink-3">Valor de la cartera</h2>
          <strong className="mt-1 block font-serif text-[2.5rem] font-normal leading-[1.05] tracking-[-0.015em] tabular-nums max-[480px]:text-[2rem] lg:text-5xl">
            {f.prefix} {formatNumber(f.total)}
          </strong>
          <p className={`mt-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2.5 py-1.5 text-base font-semibold tabular-nums ${f.dayPnl < 0 ? 'bg-danger-soft' : f.dayPnl > 0 ? 'bg-ok-soft' : 'bg-neutral-soft'} ${tone(f.dayPnl)}`}>
            <DayIcon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="whitespace-nowrap">{formatNumber(f.dayPnl, { sign: true })}</span>{' '}
            <span className="whitespace-nowrap">({formatPct(f.dayPnlPct)})</span>
            {/* The chip reads as today's move; a screen reader needs the word. */}
            <span className="sr-only">hoy</span>
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-5 sm:grid-cols-3 min-[1180px]:border-l min-[1180px]:border-t-0 min-[1180px]:pl-6 min-[1180px]:pt-0">
          <Figure label="Resultado abierto">
            <span className={tone(f.openPnl)}>
              <span className="whitespace-nowrap">{formatNumber(f.openPnl, { sign: true })}</span>{' '}
              <small className="whitespace-nowrap text-sm font-medium">{formatPct(f.openPnlPct)}</small>
            </span>
          </Figure>
          <Figure label={f.realizedLabel}>
            <span className={tone(f.realized)}>{formatNumber(f.realized, { sign: true })}</span>
          </Figure>
          <div className="col-span-2 sm:col-span-1">
            <Figure label="Capital invertido">{formatNumber(f.capital)}</Figure>
          </div>
        </dl>
      </div>
    </section>
  )
}
