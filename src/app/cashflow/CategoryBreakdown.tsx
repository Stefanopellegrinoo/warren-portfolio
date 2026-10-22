import { formatNumber, formatUSD } from '@/lib/utils'
import { SectionHead } from '@/components/resumen/ui'

export default function CategoryBreakdown({ items, total, period }: {
  items: { name: string; value: number }[]
  total: number
  period: string
}) {
  return (
    <section aria-labelledby="h-categorias">
      <SectionHead id="h-categorias" title="Por categoría" action={<span className="text-[13px] text-ink-3">{period}</span>} />
      {items.length === 0 && <p className="py-4 text-[13px] text-ink-3">Sin gastos en este período.</p>}
      <ul>
        {items.map(c => {
          const pct = total > 0 ? (c.value / total) * 100 : 0
          return (
            <li key={c.name} className="grid min-h-12 grid-cols-[minmax(0,1fr)_96px_auto_52px] items-center gap-3 border-b border-line last:border-b-0 max-[819px]:grid-cols-[minmax(0,1fr)_auto_auto] max-[819px]:gap-y-2 max-[819px]:py-3">
              <span className="min-w-0 truncate font-medium">{c.name}</span>
              <span className="relative h-1 overflow-hidden rounded-full bg-line max-[819px]:col-span-3 max-[819px]:row-start-2" aria-hidden="true">
                <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(pct, 100)}%` }} />
              </span>
              <span className="whitespace-nowrap text-right font-medium tabular-nums">{formatUSD(c.value)}</span>
              <span className="text-right text-[13px] tabular-nums text-ink-2">{formatNumber(pct, { decimals: 1 })} %</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
