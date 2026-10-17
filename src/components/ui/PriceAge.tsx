import { cn, formatAge, isPriceStale, PORTFOLIO_TIMEZONE } from '@/lib/utils'

/** Amber dot shown next to a price that is stale; renders nothing when fresh. */
export default function PriceAge({ asOf, now, className }: { asOf?: string; now?: Date; className?: string }) {
  if (!isPriceStale(asOf, now)) return null
  const when = asOf && !Number.isNaN(Date.parse(asOf))
    ? new Date(asOf).toLocaleString('es-AR', {
        timeZone: PORTFOLIO_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null
  const label = when ? `Precio desactualizado (última actualización: ${when})` : 'Precio desactualizado (sin hora de actualización)'
  const age = formatAge(asOf, now)
  return (
    <span
      role="img"
      title={label}
      aria-label={`${label}, ${age}`}
      className={cn('inline-flex items-center gap-1 ml-1.5 align-middle text-[10px] font-mono text-amber', className)}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber" />
      {age}
    </span>
  )
}
