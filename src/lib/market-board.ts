/**
 * The Mercado page's board: the Panel líder, every local share and every CEDEAR peso line, from
 * data912's BYMA peso lines, with the Resumen's MEP/CCL. One shared copy in Redis serves every user,
 * so data912 sees one GET per feed per window whoever asks (odd/tasks/market-page.md S3, S7).
 *
 * WORKER-SAFE: relative value imports only.
 */
import type { FxKind } from './fx-rates'
import { LOCAL_FEEDS, fetchLocalFeed, type Data912RawQuote } from './data912-client'
import { cacheRoute, ensureRedisConnected, getCachedRoute } from './redis'
import { getDollarInfo } from './currency'
import { createServiceClient } from './supabase-server'
import { isMarketOpen } from './utils'

/**
 * BYMA's Panel Líder, kept by hand. Source: BYMA open data, read 2026-10-31:
 * POST https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/leading-equity
 * with body {"excludeZeroPxAndQty":false,"T2":false,"T1":false,"T0":true}.
 * Refresh it from that endpoint when BYMA changes the panel.
 */
export const PANEL_LIDER = [
  'ALUA', 'BBAR', 'BMA', 'BYMA', 'CEPU', 'CRES', 'ECOG', 'EDN', 'GFVA', 'GGAL',
  'LOMA', 'METR', 'PAMP', 'SUPV', 'TGNO4', 'TGSU2', 'TRAN', 'TXAR', 'VALO', 'YPFD',
] as const

export interface MarketRow {
  symbol: string
  name: string | null
  /** ARS, the BYMA peso line. */
  price: number | null
  /** FRACTION: 0.034 = 3.4 %. */
  changePct: number | null
}

export interface MarketBoard {
  /** The Panel líder in PANEL_LIDER's order; a member missing from the feed has null price and change. */
  lider: MarketRow[]
  /** Every row of data912's arg_stocks. */
  locals: MarketRow[]
  /** Every CEDEAR peso line of arg_cedears, never a …D (MEP) or …C (cable) line. */
  cedears: MarketRow[]
  fx: { mep: number | null; ccl: number | null }
  marketOpen: boolean
  /** When the feeds were read. */
  updatedAt: string | null
}

/** Names by BYMA symbol: local shares from `activos`, every CEDEAR of the app's table (null when unnamed). */
export interface MarketNames {
  locals: Record<string, string>
  cedears: Record<string, string | null>
}

type FeedRow = Pick<Data912RawQuote, 'symbol' | 'c' | 'pct_change'>
type StoredBoard = Omit<MarketBoard, 'marketOpen'>

/**
 * The peso lines of data912's CEDEAR feed. X is a peso line when the app's CEDEAR table knows it or
 * the feed also has X+'D' or X+'C'; those companions are dollar lines and are never their own row,
 * even when the table knows a ticker spelled the same.
 */
export function cedearPesoLines(symbols: readonly string[], known: ReadonlySet<string>): string[] {
  const feed = new Set(symbols)
  const isPeso = (x: string) => known.has(x) || feed.has(`${x}D`) || feed.has(`${x}C`)
  const dollarLines = new Set(symbols.filter(isPeso).flatMap(x => [`${x}D`, `${x}C`]))
  return symbols.filter(s => isPeso(s) && !dollarLines.has(s))
}

function toRow(symbol: string, quote: FeedRow | undefined, name: string | null): MarketRow {
  const price = Number(quote?.c)
  if (!(price > 0)) return { symbol, name, price: null, changePct: null }
  const pct = Number(quote!.pct_change)
  // data912 reports percent units; every price writer stores a FRACTION (see refreshLocalPrices).
  return { symbol, name, price, changePct: Number.isFinite(pct) ? pct / 100 : null }
}

export function buildMarketBoard({ stocks, cedears, names, fx, updatedAt }: {
  stocks: FeedRow[]
  cedears: FeedRow[]
  names: MarketNames
  fx: MarketBoard['fx']
  updatedAt: string
}): StoredBoard {
  const stockBy = new Map(stocks.map(r => [r.symbol, r]))
  const cedearBy = new Map(cedears.map(r => [r.symbol, r]))
  const localName = (s: string) => names.locals[s] ?? null
  return {
    lider: PANEL_LIDER.map(s => toRow(s, stockBy.get(s), localName(s))),
    locals: stocks.map(r => toRow(r.symbol, r, localName(r.symbol))),
    cedears: cedearPesoLines(cedears.map(r => r.symbol), new Set(Object.keys(names.cedears)))
      .map(s => toRow(s, cedearBy.get(s), names.cedears[s] ?? null)),
    fx,
    updatedAt,
  }
}

const BOARD_KEY = 'market:board'
const LAST_GOOD_KEY = 'market:board:last-good'
const NAMES_KEY = 'market:names'
// BYMA's feed moves about once a minute while open; a closed market's last close does not move.
const OPEN_TTL_SEC = 60
const CLOSED_TTL_SEC = 300
// Outlives a long weekend, so a data912 outage still has a board to show.
const LAST_GOOD_TTL_SEC = 7 * 24 * 3600
// The catalogs have no writer in the app.
const NAMES_TTL_SEC = 6 * 3600

/** `BCBA:GGAL` and `GGAL.BA` are the local share GGAL. */
const localOf = (ticker: string) => /^BCBA:(.+)$/.exec(ticker)?.[1] ?? /^(.+)\.BA$/.exec(ticker)?.[1]

async function loadNames(): Promise<MarketNames> {
  const cached = await getCachedRoute<MarketNames>(NAMES_KEY)
  if (cached) return cached
  // Market tables: service role only (migration 049).
  // ponytail: one page each (PostgREST caps at 1000 rows); both tables hold a few hundred.
  const supabase = createServiceClient()
  const [activos, cedears] = await Promise.all([
    supabase.from('activos').select('ticker, nombre'),
    supabase.from('cedears').select('ticker, activos(nombre)'),
  ])
  if (activos.error) throw new Error(`activos: ${activos.error.message}`)
  if (cedears.error) throw new Error(`cedears: ${cedears.error.message}`)
  const byma: Record<string, string> = {}
  const plain: Record<string, string> = {}
  for (const a of (activos.data ?? []) as { ticker: string; nombre: string | null }[]) {
    if (!a.nombre) continue
    const symbol = localOf(a.ticker)
    if (symbol) byma[symbol] = a.nombre
    else plain[a.ticker] = a.nombre
  }
  const cedearRows = (cedears.data ?? []) as unknown as { ticker: string; activos: { nombre: string | null } | null }[]
  // A plain ticker may be the company's US ADR: still the same company, so it names the share when no BYMA spelling does.
  const names = { locals: { ...plain, ...byma }, cedears: Object.fromEntries(cedearRows.map(c => [c.ticker, c.activos?.nombre ?? null])) }
  await cacheRoute(NAMES_KEY, names, NAMES_TTL_SEC)
  return names
}

async function readFeed(kind: keyof typeof LOCAL_FEEDS): Promise<FeedRow[]> {
  const rows = (await fetchLocalFeed(LOCAL_FEEDS[kind], fetch)).filter(r => typeof r?.symbol === 'string')
  // An empty feed is a failed read, not a market without shares.
  if (!rows.length) throw new Error(`data912 ${kind}: empty feed`)
  return rows
}

// The rates are optional on the board: a missing one is null, not a failed board.
const rate = (kind: FxKind) => getDollarInfo(kind).then(d => d?.rate ?? null, () => null)

/** A fresh board, or the last good one when a feed or the catalogs fail; remembered for the window either way. */
async function refresh(ttlSec: number): Promise<StoredBoard | null> {
  let board: StoredBoard | null
  try {
    const [names, stocks, cedears, mep, ccl] = await Promise.all([
      loadNames(), readFeed('stocks'), readFeed('cedears'), rate('mep'), rate('ccl'),
    ])
    board = buildMarketBoard({ stocks, cedears, names, fx: { mep, ccl }, updatedAt: new Date().toISOString() })
    await cacheRoute(LAST_GOOD_KEY, board, LAST_GOOD_TTL_SEC)
  } catch (err) {
    console.error('[market] board refresh failed, serving the last good board:', err)
    board = await getCachedRoute<StoredBoard>(LAST_GOOD_KEY)
  }
  // A failure is remembered too: data912 being down never turns into one request per user.
  await cacheRoute(BOARD_KEY, { board }, ttlSec)
  return board
}

let refreshing: Promise<StoredBoard | null> | null = null

/** The board every user shares; null when there is none to show (no Redis, or no board yet and data912 failing). */
export async function loadMarketBoard(now: Date = new Date()): Promise<MarketBoard | null> {
  // Without Redis every request would reach data912: answer unavailable instead.
  if (!(await ensureRedisConnected())) return null
  const marketOpen = isMarketOpen(now)
  const cached = await getCachedRoute<{ board: StoredBoard | null }>(BOARD_KEY)
  // ponytail: one refresh per process at a time; a Redis lock if the web app ever runs several processes.
  const board = cached
    ? cached.board
    : await (refreshing ??= refresh(marketOpen ? OPEN_TTL_SEC : CLOSED_TTL_SEC).finally(() => { refreshing = null }))
  return board && { ...board, marketOpen }
}
