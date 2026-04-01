/**
 * IOL (InvertirOnline) API Client
 *
 * OAuth2 Resource Owner Password Credentials Grant flow.
 * Tokens are cached in Redis to avoid re-authenticating on every request.
 *
 * Required env vars:
 *   IOL_USERNAME  — tu email de InvertirOnline
 *   IOL_PASSWORD  — tu contraseña de InvertirOnline
 *
 * IOL API docs: https://api.invertironline.com/
 */

import { getRedis, isRedisReady } from './redis'

// ─── Constants ──────────────────────────────────────────────────────────────
const IOL_BASE_URL = 'https://api.invertironline.com'
const TOKEN_CACHE_KEY = 'iol:access_token'
const REFRESH_CACHE_KEY = 'iol:refresh_token'
// Expire Redis key 5 minutes before the real TTL to account for clock skew
const TOKEN_SAFETY_MARGIN_SEC = 300

// ─── Types ──────────────────────────────────────────────────────────────────
export interface IOLQuote {
  ticker: string
  price: number
  change: number
  changePercent: number
  previousClose: number
  updatedAt: string
}

interface IOLTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number // seconds
  token_type: string
}

interface IOLTitulo {
  simbolo: string
  ultimoPrecio: number
  variacionDiaria: number
  cierreAnterior: number
  fechaHora: string
}

// ─── Auth ────────────────────────────────────────────────────────────────────

/**
 * Authenticate with IOL and return access token.
 * Uses Redis to cache the token and avoid repeated auths.
 */
async function getAccessToken(): Promise<string> {
  // 1. Try Redis cache first
  if (isRedisReady()) {
    const redis = getRedis()
    const cached = await redis?.get(TOKEN_CACHE_KEY)
    if (cached) {
      return cached
    }
  }

  const username = process.env.IOL_USERNAME
  const password = process.env.IOL_PASSWORD

  if (!username || !password) {
    throw new Error('[IOL] IOL_USERNAME and IOL_PASSWORD env vars are required')
  }

  // 2. Try refresh token if we have one
  if (isRedisReady()) {
    const redis = getRedis()
    const refreshToken = await redis?.get(REFRESH_CACHE_KEY)
    if (refreshToken) {
      try {
        const token = await refreshAccessToken(refreshToken)
        return token
      } catch {
        console.warn('[IOL] Refresh token failed — doing full auth')
      }
    }
  }

  // 3. Full password grant
  return await authenticateWithPassword(username, password)
}

async function authenticateWithPassword(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({
    username,
    password,
    grant_type: 'password',
  })

  const res = await fetch(`${IOL_BASE_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`[IOL] Auth failed: ${res.status} — ${err}`)
  }

  const data: IOLTokenResponse = await res.json()
  await cacheTokens(data)
  return data.access_token
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const res = await fetch(`${IOL_BASE_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) throw new Error(`[IOL] Refresh failed: ${res.status}`)

  const data: IOLTokenResponse = await res.json()
  await cacheTokens(data)
  return data.access_token
}

async function cacheTokens(data: IOLTokenResponse): Promise<void> {
  if (!isRedisReady()) return
  const redis = getRedis()
  if (!redis) return

  const ttl = Math.max(60, data.expires_in - TOKEN_SAFETY_MARGIN_SEC)
  await redis.setex(TOKEN_CACHE_KEY, ttl, data.access_token)

  // Refresh tokens typically last 30 days
  await redis.setex(REFRESH_CACHE_KEY, 60 * 60 * 24 * 29, data.refresh_token)
  console.log(`[IOL] Tokens cached — access expires in ${ttl}s`)
}

// ─── Price Fetching ──────────────────────────────────────────────────────────

/**
 * Make an authenticated GET request to the IOL API.
 */
async function iolGet(path: string): Promise<any> {
  const token = await getAccessToken()
  const res = await fetch(`${IOL_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  if (res.status === 401) {
    // Token expired — clear cache and retry once
    if (isRedisReady()) {
      const redis = getRedis()
      await redis?.del(TOKEN_CACHE_KEY)
    }
    const newToken = await getAccessToken()
    const retry = await fetch(`${IOL_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${newToken}`, Accept: 'application/json' },
    })
    if (!retry.ok) throw new Error(`[IOL] ${path} → ${retry.status}`)
    return retry.json()
  }

  if (!res.ok) throw new Error(`[IOL] ${path} → ${res.status}`)
  return res.json()
}

/**
 * Determine the IOL market for a ticker.
 * ONs typically trade in BCBA. Adjust if needed.
 */
function getMarketForTicker(ticker: string): string {
  // Most Argentine bonds and ONs trade in BCBA
  return 'bCBA'
}

/**
 * Fetch a single ON/bond quote from IOL.
 */
export async function fetchIOLPrice(ticker: string): Promise<IOLQuote | null> {
  const upperTicker = ticker.toUpperCase().trim()
  const market = getMarketForTicker(upperTicker)

  try {
    // IOL endpoint: GET /api/v2/{mercado}/Titulos/{simbolo}/cotizacion
    const data: IOLTitulo = await iolGet(`/api/v2/${market}/Titulos/${upperTicker}/cotizacion`)

    const price = data.ultimoPrecio ?? 0
    const previousClose = data.cierreAnterior ?? 0
    const change = price - previousClose
    const changePercent = previousClose > 0 ? change / previousClose : 0

    return {
      ticker: upperTicker,
      price,
      change,
      changePercent,
      previousClose,
      updatedAt: data.fechaHora ?? new Date().toISOString(),
    }
  } catch (err) {
    console.error(`[IOL] Failed to fetch ${upperTicker}:`, err)
    return null
  }
}

/**
 * Fetch multiple ON quotes in parallel.
 * Returns a Map<ticker, IOLQuote> with only successful results.
 */
export async function fetchIOLPrices(tickers: string[]): Promise<Map<string, IOLQuote>> {
  if (tickers.length === 0) return new Map()

  console.log(`[IOL] Fetching ${tickers.length} tickers: ${tickers.join(', ')}`)

  const results = await Promise.allSettled(
    tickers.map(t => fetchIOLPrice(t))
  )

  const quotes = new Map<string, IOLQuote>()
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value) {
      quotes.set(tickers[i].toUpperCase(), result.value)
    }
  })

  console.log(`[IOL] Got ${quotes.size}/${tickers.length} quotes`)
  return quotes
}
