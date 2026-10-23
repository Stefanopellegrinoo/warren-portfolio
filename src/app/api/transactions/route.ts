import { NextRequest, NextResponse } from 'next/server'
import { processTransaction } from '@/lib/portfolio-engine'
import { invalidateUserCache } from '@/lib/redis'
import { validateBody, validateQueryParams, validationErrorResponse } from '@/lib/api/validation'
import { TransactionSchema, TransactionQuerySchema, CedearTradeSchema } from '@/lib/schemas/transaction'
import { PaginatedResponse } from '@/lib/schemas/common'
import { serverError } from '@/lib/api/errors'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase-server'
import { resolveTickerIdentity } from '@/lib/ticker-identity'
import { getCataloguedTicker, upsertTickerIdentity } from '@/lib/ticker-catalog'
import { recordCedearTrade, TradeRecordError } from '@/lib/trade-record'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    // Validate query params
    const { ticker, limit, offset } = validateQueryParams(TransactionQuerySchema, req.url)

    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (ticker) query = query.eq('ticker', ticker.toUpperCase())

    const { data, error, count } = await query
    if (error) throw error

    const page = Math.floor(offset / limit) + 1
    const response: PaginatedResponse<any> = {
      data: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: count ? Math.ceil(count / limit) : 0,
      },
    }

    return NextResponse.json(response)
  } catch (err: any) {
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }

    return serverError('Transactions', err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    // A CEDEAR broker ticket (`tradeCurrency`) carries raw values; every other
    // caller sends engine values and keeps the old schema.
    const raw = await req.json()
    const isTicket = raw && typeof raw === 'object' && 'tradeCurrency' in raw
    const { confirmTicker, ...parsed } = isTicket ? validateBody(CedearTradeSchema, raw) : validateBody(TransactionSchema, raw)
    // Derived before the identity gate so an unknown CEDEAR fails before the
    // catalog is written. cedears and fx_rates are market tables: service role (S12).
    const body = 'tradeCurrency' in parsed ? await recordCedearTrade(createServiceClient(), parsed) : parsed

    // Identity gate. ONs are exempt: Data912 prices them and Yahoo has no such
    // instrument, so resolution would fail for every legitimate ON.
    // An ABSENT assetType is a stock, not an exemption.
    if (body.assetType !== 'ON') {
      // ticker_identity is a market table, read with the service role (S12:
      // `authenticated` has no SELECT on it). A broken read still cannot look
      // like "already catalogued": getCataloguedTicker throws on any error, and
      // the session itself was verified by requireUser above.
      const catalogued = await getCataloguedTicker(supabase, body.ticker)

      if (!catalogued) {
        let resolution
        try {
          resolution = await resolveTickerIdentity(body.ticker)
        } catch (err) {
          // Entering an unverified ticker because a third party is down is
          // precisely the failure this gate exists to prevent.
          console.error('[Transactions] ticker verification unavailable:', err)
          return NextResponse.json(
            { error: 'Could not verify the ticker right now. Try again shortly.' },
            { status: 503 }
          )
        }

        if (!confirmTicker) {
          return NextResponse.json(
            { code: 'TICKER_UNCONFIRMED', resolution },
            { status: 409 }
          )
        }

        // Written before the transaction: if this fails the request fails, so
        // the catalog can never fall behind the ledger it is meant to describe.
        //
        // WRITE on the service client, NOT the request-scoped one. `supabase`
        // here carries the anon key plus the user's session, and migration 032
        // grants INSERT/UPDATE on ticker_identity `TO service_role` only — the
        // same shape as the shared `ons` catalog. With the user client this
        // upsert is denied, the request 500s, and the gate closes on every new
        // ticker forever. The user is already authenticated above; this is a
        // privileged write on an already-validated path, not a widening of who
        // is allowed to write the catalog.
        await upsertTickerIdentity(createServiceClient(), resolution, body.ticker)
      }
    }

    const result = await processTransaction(supabase, user.id, body)
    // Invalidate Cache since portfolio mutated
    await invalidateUserCache(user.id)

    return NextResponse.json(result, { status: 201 })
  } catch (err: any) {
    if (err instanceof TradeRecordError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    // Handle validation errors
    if (err.status === 400) {
      return validationErrorResponse(err)
    }

    return serverError('Transactions', err)
  }
}
