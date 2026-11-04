import { NextResponse, type NextRequest } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { MARKET_DATA_UNAVAILABLE, serverError } from '@/lib/api/errors'
import { loadMarketBoard } from '@/lib/market-board'
import { filterRows, listRows, marketRows, pageRows, parsePage, parseSize, parseSort, sortRows } from '@/lib/market-view'

export const dynamic = 'force-dynamic'

// Signed-in users only, limited per user; the board itself is one shared Redis copy (market-board.ts).
const ROUTE_LIMIT = 60
const ROUTE_WINDOW_SEC = 60
const MAX_SYMBOLS = 200
const MAX_QUERY = 50

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 })

/**
 * The Mercado board: Panel líder, local shares and CEDEAR peso lines in pesos, MEP/CCL and the market state.
 * With `list=lider|cedears` or `symbols=A,B` it answers one page of that list instead, searched (`q`),
 * sorted (`sort=<key>:<asc|desc>`) and cut (`page`, `size`) here; the bare call stays the full board.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  if (!(await rateLimit(`rl:market:${authResult.user.id}`, ROUTE_LIMIT, ROUTE_WINDOW_SEC))) {
    return tooManyRequests(ROUTE_WINDOW_SEC)
  }
  const params = req.nextUrl.searchParams
  const list = params.get('list')
  const symbolsParam = params.get('symbols')
  if (list !== null && symbolsParam !== null) return badRequest('Pedí una lista o unos símbolos, no los dos')
  if (list !== null && list !== 'lider' && list !== 'cedears') return badRequest('Lista desconocida')
  const symbols = (symbolsParam ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (symbols.length > MAX_SYMBOLS) return badRequest(`Demasiados símbolos: hasta ${MAX_SYMBOLS}`)
  try {
    const board = await loadMarketBoard()
    if (!board) {
      return NextResponse.json({ error: MARKET_DATA_UNAVAILABLE }, { status: 503, headers: { 'Retry-After': String(ROUTE_WINDOW_SEC) } })
    }
    // Tabs still running the first Mercado ask for the whole board.
    if (list === null && symbolsParam === null) return NextResponse.json(board)
    const rows = list !== null ? marketRows(board, list) : listRows(symbols, board)
    const found = filterRows(rows, (params.get('q') ?? '').trim().slice(0, MAX_QUERY))
    const size = parseSize(params.get('size'))
    const page = pageRows(sortRows(found, parseSort(params.get('sort'))), parsePage(params.get('page')), size)
    return NextResponse.json({
      ...page,
      size,
      counts: { lider: board.lider.length, cedears: board.cedears.length },
      fx: board.fx,
      marketOpen: board.marketOpen,
      updatedAt: board.updatedAt,
    })
  } catch (err) {
    return serverError('API /market', err)
  }
}
