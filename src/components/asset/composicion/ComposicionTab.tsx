'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { AssetPage } from '@/lib/fundamentals/service'
import { parseTicker } from '@/lib/fundamentals/ticker'
import { sectorName } from '@/lib/fundamentals/summary'
import { assetHref } from '@/components/shell/nav'
import { Card } from '@/components/asset/resumen/ResumenTab'
import { formatPct } from '@/lib/utils'

const share = (w: number) => formatPct(w, { digits: 1, sign: false })

/** A holding's own page: a symbol with a letter names a listing (NVDA, 2330.TW); a bare number (005935) does not. */
function hrefOf(symbol: string | null): string | null {
  const t = symbol && /[A-Z]/i.test(symbol) ? parseTicker(symbol) : null
  return t && assetHref(t)
}

/**
 * An ETF's Composición (odd/tasks/asset-page.md T10, S1; design goal 9): its largest holdings, each company
 * opening its own page, and its sectors in Spanish with bars.
 */
export function ComposicionTab({ page }: { page: AssetPage }) {
  const f = page.profile?.fund
  if (!f) return <p className="rounded-md bg-surface-2 px-4 py-3 text-[15px] text-ink-2">No pudimos traer la composición del fondo. Probá de nuevo en un rato.</p>
  if (f.holdings.length === 0 && f.sectors.length === 0) return <p className="py-6 text-[15px] text-ink-2">No tenemos la composición de este fondo.</p>
  const top = f.sectors[0]?.weight ?? 1
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      {f.holdings.length > 0 && (
        <Card title="Principales tenencias">
          <p className="mt-1 text-[15px] text-ink-2">
            Las {f.holdings.length} más grandes suman {share(f.holdings.reduce((sum, h) => sum + h.weight, 0))} del fondo.
          </p>
          <ul className="mt-2">
            {f.holdings.map((h, i) => {
              const href = hrefOf(h.symbol)
              const body = (
                <>
                  <span className="min-w-0 flex-1 break-words leading-snug">
                    {h.name}
                    {h.symbol && <> <span className="ml-1 font-mono text-ink-2">{h.symbol}</span></>}
                  </span>{' '}
                  <span className="shrink-0 font-mono font-medium">{share(h.weight)}</span>
                  {href ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-hidden="true" /> : <span className="w-3.5 shrink-0" aria-hidden="true" />}
                </>
              )
              const row = 'flex min-h-11 items-center gap-3 py-2 text-[15px]'
              return (
                <li key={`${i}:${h.name}`} className="border-t border-line first:border-t-0">
                  {href ? <Link href={href} className={`${row} -mx-4 px-4 hover:bg-hover`}>{body}</Link> : <div className={row}>{body}</div>}
                </li>
              )
            })}
          </ul>
        </Card>
      )}
      {f.sectors.length > 0 && (
        <Card title="Por sector">
          <ul className="mt-2">
            {f.sectors.map((s) => (
              <li key={s.sector} className="border-t border-line py-2 text-[15px] first:border-t-0">
                <div className="flex items-center justify-between gap-3">
                  <span>{sectorName(s.sector)}</span>{' '}
                  <span className="font-mono font-medium">{share(s.weight)}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-surface-2" aria-hidden="true">
                  <div data-bar className="h-2 rounded-full bg-accent" style={{ width: `${Math.round((s.weight / top) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
