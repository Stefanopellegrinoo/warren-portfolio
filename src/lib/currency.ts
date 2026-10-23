import { getRedis, isRedisReady } from './redis'
import { createServiceClient } from './supabase-server'
import { FX_SERIES, type FxKind } from './fx-rates'
import { argentinaDate } from './utils'

/**
 * The app's one dollar series (odd/tasks/nucleo-ledger.md T1.2): today is live from
 * dolarapi.com, closed days come from fx_rates (argentinadatos, same provider), and
 * the rate of a moment is the mid of buy and sell, as getFxRate uses.
 */

const LIVE_URL = 'https://dolarapi.com/v1/dolares/'
const CACHE_TTL = 60 // seconds: "ask every time", one fetch per minute at most
const LKP_TTL = 30 * 24 * 3600 // Redis is noeviction, every key must expire
const FETCH_TIMEOUT_MS = 5_000
const PAGE = 1000 // PostgREST row cap per request

export interface DollarInfo {
  rate: number
  /** ISO instant the provider last updated the rate. */
  asOf: string
  source: 'live' | 'cache' | 'lkp'
}

async function readKey(key: string): Promise<{ rate: number; asOf: string } | null> {
  if (!isRedisReady()) return null
  const raw = await getRedis()?.get(key)
  return raw ? JSON.parse(raw) : null
}

async function fetchLive(kind: FxKind): Promise<{ rate: number; asOf: string }> {
  const res = await fetch(LIVE_URL + FX_SERIES[kind], { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`dolarapi ${FX_SERIES[kind]}: HTTP ${res.status}`)
  const d = await res.json()
  if (!(d.compra > 0 && d.venta > 0)) throw new Error(`dolarapi ${FX_SERIES[kind]}: no buy/sell`)
  return { rate: (d.compra + d.venta) / 2, asOf: d.fechaActualizacion }
}

/**
 * Lookup order: 1-minute cache, live dolarapi, 30-day last-known. Returns null when
 * nothing real exists: callers MUST NOT convert with an invented number.
 */
export async function getDollarInfo(kind: FxKind): Promise<DollarInfo | null> {
  const key = `currency:${kind}`
  const cached = await readKey(key)
  if (cached) return { ...cached, source: 'cache' }
  try {
    const live = await fetchLive(kind)
    if (isRedisReady()) {
      const value = JSON.stringify(live)
      await getRedis()?.setex(key, CACHE_TTL, value)
      await getRedis()?.setex(`${key}:lkp`, LKP_TTL, value)
    }
    return { ...live, source: 'live' }
  } catch (err) {
    console.error(`[Currency] live ${kind} failed:`, err)
  }
  const lkp = await readKey(`${key}:lkp`)
  if (lkp) return { ...lkp, source: 'lkp' }
  console.error(`[Currency] No ${kind} rate available (live failed, no last-known)`)
  return null
}

export async function getCCLRateInfo(): Promise<DollarInfo | null> {
  return getDollarInfo('ccl')
}

export async function getCCLRate(): Promise<number | null> {
  return (await getDollarInfo('ccl'))?.rate ?? null
}

/**
 * Closed-day rates of `kind` from fx_rates, date → mid, before today (Argentina): today's
 * row is still moving, today is getDollarInfo. Throws on a read failure.
 */
export async function getHistoricalDollar(kind: FxKind, startDate: Date, endDate: Date = new Date()): Promise<Map<string, number>> {
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const supabase = createServiceClient()
  const rates = new Map<string, number>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('fx_rates')
      .select('date, buy, sell')
      .eq('kind', kind)
      .gte('date', day(startDate))
      .lte('date', day(endDate))
      .lt('date', argentinaDate())
      .order('date')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`fx_rates read: ${error.message}`)
    for (const r of data ?? []) rates.set(r.date, (Number(r.buy) + Number(r.sell)) / 2)
    if (!data || data.length < PAGE) return rates
  }
}

export async function getHistoricalCCL(startDate: Date, endDate: Date = new Date()): Promise<Map<string, number>> {
  return getHistoricalDollar('ccl', startDate, endDate)
}
