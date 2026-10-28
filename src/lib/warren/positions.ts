import type { Position, ONPosition, PortfolioSummary, Transaction, PaginatedResponse } from '@/types'
import { cachedValue, load } from '@/lib/client-cache'

/** The client-cache key of GET /api/positions: its last answer, for whoever needs it at once. */
export const POSITIONS_KEY = 'api:positions'
const CEDEAR_RATIOS_KEY = 'api:cedear-ratios'

const DEFAULT_TRANSACTIONS_LIMIT = 500

interface PositionsApiResponse {
  positions: Position[]
  onPositions: ONPosition[]
  summary: PortfolioSummary
  lastRefresh: string | null
  /** The Pesos / MEP / Cable views; read them with `viewsOf`. */
  currencies?: unknown
}

/** The portfolio; components asking at the same time share one request (the heaviest endpoint). */
export function getPortfolio(): Promise<PositionsApiResponse> {
  return load(POSITIONS_KEY, async () => {
    const res = await fetch('/api/positions')
    if (!res.ok) throw new Error(`GET /api/positions failed: ${res.status} ${res.statusText}`)
    return res.json() as Promise<PositionsApiResponse>
  })
}

export async function getPositions(): Promise<Position[]> {
  const data = await getPortfolio()
  return data.positions ?? []
}

export async function getTransactions(ticker?: string): Promise<Transaction[]> {
  const url = ticker
    ? `/api/transactions?ticker=${encodeURIComponent(ticker)}&limit=${DEFAULT_TRANSACTIONS_LIMIT}`
    : `/api/transactions?limit=${DEFAULT_TRANSACTIONS_LIMIT}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch transactions: ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as PaginatedResponse<Transaction>
  return data.data
}

/** The CEDEAR ratios, a catalog: asked once per tab. */
export async function getCedearRatios(): Promise<Map<string, number>> {
  return cachedValue<Map<string, number>>(CEDEAR_RATIOS_KEY) ?? load(CEDEAR_RATIOS_KEY, async () => {
    const res = await fetch('/api/cedears')
    if (!res.ok) {
      throw new Error(`Failed to fetch CEDEAR ratios: ${res.status} ${res.statusText}`)
    }
    const data: Array<{ ticker: string; ratio: number; nombre: string }> = await res.json()
    return new Map(data.map((c) => [c.ticker, c.ratio]))
  })
}
