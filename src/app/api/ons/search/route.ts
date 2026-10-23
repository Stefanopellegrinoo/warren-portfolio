import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { getAvailableCorporateBonds } from '@/lib/data912-client'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Signed-in users only, limited per user (S13); `limit` is clamped (S5).
const ROUTE_LIMIT = 60
const ROUTE_WINDOW_SEC = 60
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

/**
 * Search endpoint for corporate bonds (ONs) - READ ONLY
 * 
 * Query params:
 * - q: search query (ticker or name)
 * - limit: max results (default: 10, clamped to 1..50)
 * 
 * EXACT flow:
 * 1. User searches for ON (e.g., types "AER" in frontend)
 * 2. Frontend calls `/api/ons/search?q=AER`
 * 3. Backend searches BOTH in local database (table `ons`) AND data912.com
 * 4. Returns combined results (DB results first for speed)
 * 5. NO auto-insert - bonds are only saved when user creates a transaction
 */
export async function GET(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  if (!(await rateLimit(`rl:ons-search:${authResult.user.id}`, ROUTE_LIMIT, ROUTE_WINDOW_SEC))) {
    return tooManyRequests(ROUTE_WINDOW_SEC)
  }
  try {
    // `ons` is readable only by the service role (S12).
    const supabase = createServiceClient()

    const { searchParams } = new URL(req.url)
    const query = searchParams.get('q')?.toUpperCase().trim() || ''
    const requested = parseInt(searchParams.get('limit') ?? '', 10)
    const limit = Number.isNaN(requested) ? DEFAULT_LIMIT : Math.min(Math.max(requested, 1), MAX_LIMIT)

    if (!query || query.length < 2) {
      return NextResponse.json({ 
        results: [],
        message: 'Query must be at least 2 characters'
      })
    }

    // 1. Search in local database (for bonds we've already traded)
    const { data: existingBonds } = await supabase
      .from('ons')
      .select('ticker, name')
      .ilike('ticker', `%${query}%`)
      .limit(limit)

    const databaseResults = (existingBonds || []).map((bond: any) => ({
      ticker: bond.ticker,
      name: bond.name,
      source: 'database' as const
    }))

    // 2. Search data912.com for DOLLAR-MEP bonds only (ticker ends with 'D')
    const allBonds = await getAvailableCorporateBonds()
    
    // Filter by query AND ensure it's a DOLLAR-MEP bond (ticker ends with 'D')
    const matchingData912Bonds = allBonds
      .filter(ticker => ticker.includes(query) && ticker.endsWith('D'))
      .slice(0, limit)

    const data912Results = matchingData912Bonds.map(ticker => ({
      ticker,
      source: 'data912' as const
    }))

    // 3. Combine results: DB results first (already traded), then data912 (available)
    const allResults = [
      ...databaseResults,
      ...data912Results.filter((bond: { ticker: string }) => 
        !databaseResults.some((db: { ticker: string }) => db.ticker === bond.ticker)
      )
    ].slice(0, limit)

    return NextResponse.json({
      results: allResults,
      query,
      count: allResults.length
    })

  } catch (error) {
    console.error('[ON Search] Error:', error)
    return NextResponse.json({ error: 'Failed to search bonds' }, { status: 500 })
  }
}