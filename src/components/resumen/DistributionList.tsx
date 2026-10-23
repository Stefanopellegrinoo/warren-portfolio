'use client'

import { useEffect, useRef, useState } from 'react'
import { formatNumber } from '@/lib/utils'
import { treemap } from '@/lib/resumen/treemap'
import { SectionHead } from './ui'

const HEIGHT = 220
// Before the first measure (and on the server) the map is drawn for a typical side column.
const DEFAULT_WIDTH = 360

// Color follows the class, never its size. Cash is not an investment: it stays neutral.
const COLORS: Record<string, string> = {
  Acciones: 'var(--series-1)',
  CEDEARs: 'var(--series-2)',
  'Obligaciones negociables': 'var(--series-3)',
  Caja: 'var(--neutral-dot)',
}
// Narrow blocks use the short name; the full one stays in the tooltip and for screen readers.
const SHORT: Record<string, string> = { 'Obligaciones negociables': 'ONs' }
const fill = (label: string) => `color-mix(in oklab, ${COLORS[label] ?? 'var(--neutral-dot)'} 30%, var(--surface))`

type Item = { label: string; pct: number; value: number }

/** Part-to-whole as a treemap: each class's block is as big as its share. */
export default function DistributionList({ items, prefix }: { items: Item[]; prefix: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // An empty class only adds noise; cash always matters, even at zero.
  const shown = items.filter(d => d.pct > 0 || d.label === 'Caja')
  const byLabel = new Map(shown.map(d => [d.label, d]))
  const tiles = treemap(shown.map(d => ({ id: d.label, weight: d.pct })), width / HEIGHT)
  const fits = (w: number, h: number) => w * width >= 76 && h * HEIGHT >= 52
  // Blocks too small for their own label are named under the map.
  const small = shown.filter(d => {
    const t = tiles.find(t => t.id === d.label)
    return !t || !fits(t.w, t.h)
  })

  const pct = (d: Item) => `${formatNumber(d.pct, { decimals: 1 })} %`
  const amount = (d: Item) => `${prefix} ${formatNumber(d.value)}`

  return (
    <section aria-labelledby="h-distribucion">
      <SectionHead id="h-distribucion" title="Distribución" />
      <div ref={box} className="relative mt-4" style={{ height: HEIGHT }}>
        <ul>
          {tiles.map(t => {
            const d = byLabel.get(t.id)!
            const roomy = fits(t.w, t.h)
            const px = t.w * width
            const showAmount = px >= 110 && t.h * HEIGHT >= 84
            const short = px < 170 && SHORT[d.label]
            return (
              <li
                key={t.id}
                data-block={t.id}
                title={`${d.label}: ${pct(d)}, ${amount(d)}`}
                className="absolute p-px"
                style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: `${t.w * 100}%`, height: `${t.h * 100}%` }}
              >
                <div className="flex h-full flex-col justify-between overflow-hidden rounded-md p-3" style={{ background: fill(d.label), boxShadow: `inset 3px 0 0 ${COLORS[d.label] ?? 'var(--neutral-dot)'}` }}>
                  <span className={roomy ? 'truncate text-[13px] font-medium text-ink-2' : 'sr-only'}>
                    {short ? <><span aria-hidden="true">{short}</span><span className="sr-only">{d.label}</span></> : d.label}
                  </span>
                  <span className={roomy ? 'grid' : 'sr-only'}>
                    <span className={`whitespace-nowrap font-semibold leading-tight tabular-nums ${px >= 120 ? 'text-xl' : 'text-base'}`}>{pct(d)}</span>
                    <span className={showAmount ? 'truncate text-[13px] tabular-nums text-ink-2' : 'sr-only'}>{amount(d)}</span>
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      {small.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {small.map(d => (
            // Already read inside its block, unless it has no block at all (cash at 0 %).
            <li key={d.label} aria-hidden={tiles.some(t => t.id === d.label) || undefined} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[d.label] ?? 'var(--neutral-dot)' }} />
              <span className="font-medium">{d.label}</span>
              <span className="tabular-nums text-ink-2">{pct(d)}</span>
              <span className="tabular-nums text-ink-3">{amount(d)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
