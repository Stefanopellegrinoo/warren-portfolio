import Link from 'next/link'
import { LineChart } from 'lucide-react'
import { priceText } from '@/components/trading/ui'
import { signTone } from '@/components/ons/ui'
import { formatNumber, formatPct } from '@/lib/utils'
import type { AssetPage } from '@/lib/fundamentals/service'

const CURRENCY: Record<string, string> = { USD: 'US$', ARS: '$' }

/** Ticker, market, name and price, as in the approved mockup (odd/tasks/asset-page.md S1, S7). */
export default function AssetHeader({ page }: { page: AssetPage }) {
  const { ticker, exchange, name, price, currency, bymaListing, dayChange } = page
  // The asked listing's market; people know Buenos Aires' as BYMA.
  const market = exchange === 'BCBA' ? 'BYMA' : exchange
  // Non-breaking space: the currency never wraps away from its amount.
  const shownPrice = currency ? `${CURRENCY[currency] ?? currency} ${priceText(price)}` : priceText(price)
  return (
    <header className="mb-6 flex items-start justify-between gap-6 max-[819px]:flex-col max-[819px]:gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="break-all text-[2rem] font-semibold leading-tight max-[819px]:text-[1.75rem]">{ticker.slice(ticker.indexOf(':') + 1)}</h1>
          {market && <span className="inline-flex h-[22px] items-center rounded bg-surface-2 px-2 text-xs font-medium text-ink-2">{market}</span>}
        </div>
        <p className="mt-1 break-words text-[17px] text-ink-2">{name}</p>
        {bymaListing && <p className="mt-1 text-sm text-ink-2">Datos de {name} en BYMA</p>}
      </div>
      <div className="flex flex-none flex-col items-end gap-1 max-[819px]:items-start">
        {/* A bare number would read as dollars: say whose price it is. */}
        {!currency && <p className="text-sm text-ink-2">{exchange ? `Precio en ${exchange}` : 'Precio'}</p>}
        <p className="font-mono text-[2rem] font-semibold leading-tight tabular-nums max-[819px]:text-[1.75rem]">{shownPrice}</p>
        {dayChange && (
          <p className={`font-mono text-[15px] tabular-nums ${signTone(dayChange.abs)}`}>
            {`${formatNumber(dayChange.abs, { decimals: Math.abs(price) < 1 ? 4 : 2, sign: true })} (${formatPct(dayChange.pct)}) hoy`}
          </p>
        )}
        <Link
          href={`/trading?symbol=${encodeURIComponent(ticker)}`}
          className="inline-flex min-h-6 items-center gap-1.5 text-sm font-medium text-accent-ink hover:underline hover:underline-offset-2 max-[819px]:min-h-11"
        >
          <LineChart className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          Ver gráfico
        </Link>
      </div>
    </header>
  )
}
