import { formatPct, formatUSD } from '@/lib/utils'

/** Weights as rows with a thin bar, the Resumen "Distribución" idiom. `pct` is a fraction; amounts in US$ unless `format` says otherwise. */
export default function ShareList({ items, format = formatUSD }: { items: { name: string; pct: number; value?: number }[]; format?: (n: number) => string }) {
  return (
    <ul>
      {items.map(d => (
        <li key={d.name} className="grid min-h-12 grid-cols-[minmax(0,1fr)_96px_minmax(0,auto)] items-center gap-3 border-b border-line last:border-b-0 max-[819px]:grid-cols-[minmax(0,1fr)_auto] max-[819px]:gap-y-2 max-[819px]:py-3">
          <span className="truncate font-medium max-[819px]:whitespace-normal">{d.name}</span>
          <span className="relative h-1 overflow-hidden rounded-full bg-line max-[819px]:col-span-2 max-[819px]:row-start-2" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(Math.max(d.pct, 0), 1) * 100}%` }} />
          </span>
          <span className="text-right text-[13px] tabular-nums text-ink-2">
            {d.value !== undefined && <span className="mr-2 text-ink">{format(d.value)}</span>}
            {formatPct(d.pct, { digits: 1, sign: false })}
          </span>
        </li>
      ))}
    </ul>
  )
}
