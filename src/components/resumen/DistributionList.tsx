import { formatNumber } from '@/lib/utils'
import { SectionHead } from './ui'

export default function DistributionList({ items }: { items: { label: string; pct: number }[] }) {
  return (
    <section aria-labelledby="h-distribucion">
      <SectionHead id="h-distribucion" title="Distribución" />
      <ul>
        {items.map(d => (
          <li key={d.label} className="grid min-h-12 grid-cols-[minmax(0,1fr)_96px_52px] items-center gap-3 border-b border-line last:border-b-0 max-[819px]:grid-cols-[minmax(0,1fr)_auto] max-[819px]:gap-y-2 max-[819px]:py-3">
            <span className="font-medium">{d.label}</span>
            <span className="relative h-1 overflow-hidden rounded-full bg-line max-[819px]:col-span-2 max-[819px]:row-start-2" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(d.pct, 100)}%` }} />
            </span>
            <span className="text-right text-[13px] tabular-nums text-ink-2">{formatNumber(d.pct, { decimals: 1 })} %</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
