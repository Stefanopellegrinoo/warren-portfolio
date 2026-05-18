import type { Position, ONPosition, PortfolioSummary, Transaction, PaginatedResponse } from '@/types'

const DEFAULT_TRANSACTIONS_LIMIT = 500

interface PositionsApiResponse {
  positions: Position[]
  onPositions: ONPosition[]
  summary: PortfolioSummary
  lastRefresh: string | null
}

export async function getPortfolio(): Promise<PositionsApiResponse> {
  const res = await fetch('/api/positions')
  if (!res.ok) throw new Error(`GET /api/positions failed: ${res.status} ${res.statusText}`)
  return res.json() as Promise<PositionsApiResponse>
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

export async function getCedearRatios(): Promise<Map<string, number>> {
  const res = await fetch('/api/cedears')
  if (!res.ok) {
    throw new Error(`Failed to fetch CEDEAR ratios: ${res.status} ${res.statusText}`)
  }
  const data: Array<{ ticker: string; ratio: number; nombre: string }> = await res.json()
  return new Map(data.map((c) => [c.ticker, c.ratio]))
}
