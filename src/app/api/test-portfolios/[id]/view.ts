import type { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadOnAnalyses } from '@/lib/on-catalog'
import { analyzePortfolio } from '@/lib/on-portfolio-analytics'
import { MAX_ITEMS, MAX_PORTFOLIOS } from '@/lib/schemas/test-portfolio'
import { dbFail, fail, NOT_FOUND, toItem, type ItemRow } from '@/lib/test-portfolios'
import { argentinaDate } from '@/lib/utils'

export const PORTFOLIO_COLS = 'id, name, created_at, updated_at'
export const portfolioOf = (p: any) => ({ id: p.id, name: p.name, createdAt: p.created_at, updatedAt: p.updated_at })
export type Catalog = Awaited<ReturnType<typeof loadOnAnalyses>>

/**
 * GET's body: the portfolio, its items and the computed analysis (nothing derived is stored). An edit answers
 * with it too, so the page needs one round trip (odd/tasks/rendimiento.md S9); `catalog` reuses one already loaded.
 */
export async function portfolioView(sb: SupabaseClient, id: string, catalog?: Catalog): Promise<{ view: Record<string, unknown> } | { error: NextResponse }> {
  const { data: portfolio, error } = await sb.from('test_portfolios').select(PORTFOLIO_COLS).eq('id', id).maybeSingle()
  if (error) return { error: dbFail(error, 'portfolio') }
  if (!portfolio) return { error: NOT_FOUND() }
  const { data: rows, error: itemsError } = await sb.from('test_portfolio_items').select('id, isin, input_mode, amount, manual_price, created_at').eq('portfolio_id', id).order('created_at', { ascending: true })
  if (itemsError) return { error: dbFail(itemsError, 'item') }

  try {
    const items = ((rows ?? []) as ItemRow[]).map(toItem)
    const { analyses, asOf, stale, prices } = catalog ?? await loadOnAnalyses(sb)
    const analysis = analyzePortfolio({ items, analyses, today: argentinaDate() })
    return { view: { portfolio: portfolioOf(portfolio), items, analysis, asOf, stale, prices, limits: { portfolios: MAX_PORTFOLIOS, items: MAX_ITEMS } } }
  } catch (e) {
    console.error('[Test portfolios API] Failed to compute the portfolio:', e)
    return { error: fail('No se pudo calcular la cartera', 500) }
  }
}

/** What an edit adds to its answer: the view, or nothing when it cannot be built (the edit was saved anyway). */
export async function viewAfterEdit(sb: SupabaseClient, id: string, catalog?: Catalog): Promise<{ view?: Record<string, unknown> }> {
  const r = await portfolioView(sb, id, catalog)
  return 'view' in r ? { view: r.view } : {}
}
