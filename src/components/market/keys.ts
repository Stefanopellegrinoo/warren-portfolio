import type { ViewRow } from '@/lib/market-view'

export interface WatchlistRow { id: string; name: string; item_count: number }

/** One page of a list, as `GET /api/market?list=…|symbols=…&page&size&sort&q` answers it. */
export interface MarketPageData {
  rows: ViewRow[]
  total: number
  page: number
  size: number
  pages: number
  counts: { lider: number; cedears: number }
  fx: { mep: number | null; ccl: number | null }
  marketOpen: boolean
  updatedAt: string | null
}

export const CARTERA = 'cartera'
export const LISTS_KEY = 'market:lists'
export const CARTERA_KEY = 'market:cartera'
export const itemsKey = (id: string) => `market:list:${id}`
