'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PAGE_SIZES } from '@/lib/market-view'
import { field } from '@/components/ons/ui'

interface Props {
  page: number
  pages: number
  total: number
  size: number
  onPage: (page: number) => void
  onSize: (size: number) => void
}

/** The page numbers to show: the first, the last and the neighbours of the current one, gaps as null. */
export function pageNumbers(page: number, pages: number): (number | null)[] {
  const keep = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)
  return keep.flatMap((p, i) => (i > 0 && p - keep[i - 1] > 1 ? [null, p] : [p]))
}

// 44 px targets wherever the app is in its phone layout (below 820 px).
const STEP = 'grid h-8 min-w-8 place-items-center rounded-md px-1.5 font-mono text-[13px] text-ink-2 hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40 max-[819px]:h-11 max-[819px]:min-w-11'

/** S10: "1–25 de 380", numbered pages and the page size; on phones "‹ Página 1 de 16 · 380 ›". */
export default function MarketPager({ page, pages, total, size, onPage, onSize }: Props) {
  if (total === 0) return null
  const from = (page - 1) * size + 1
  const to = Math.min(page * size, total)
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2.5 text-[13px] text-ink-3">
      <span className="tabular-nums max-[639px]:hidden">{from}–{to} de {total}</span>
      <nav aria-label="Páginas" className="flex items-center gap-1 max-[639px]:w-full max-[639px]:justify-between">
        <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}
          className={cn(STEP, 'max-[639px]:h-11 max-[639px]:w-11 max-[639px]:border max-[639px]:border-line')}>
          <ChevronLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
        <span className="tabular-nums min-[640px]:hidden">Página <b className="font-medium text-ink">{page}</b> de {pages} · {total}</span>
        {pageNumbers(page, pages).map((p, i) => p === null
          ? <span key={`gap-${i}`} aria-hidden="true" className="px-1 max-[639px]:hidden">…</span>
          : (
            <button key={p} type="button" aria-label={`Página ${p}`} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}
              className={cn(STEP, 'max-[639px]:hidden', p === page && 'bg-primary text-primary-on hover:bg-primary hover:text-primary-on')}>
              {p}
            </button>
          ))}
        <button type="button" aria-label="Página siguiente" disabled={page >= pages} onClick={() => onPage(page + 1)}
          className={cn(STEP, 'max-[639px]:h-11 max-[639px]:w-11 max-[639px]:border max-[639px]:border-line')}>
          <ChevronRight className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </nav>
      <label className="flex items-center gap-2 max-[639px]:hidden">
        Por página
        <select aria-label="Filas por página" value={size} onChange={(e) => onSize(Number(e.target.value))} className={cn(field, 'h-8 min-h-8 w-auto px-2 py-0 max-[819px]:h-11')}>
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    </div>
  )
}
