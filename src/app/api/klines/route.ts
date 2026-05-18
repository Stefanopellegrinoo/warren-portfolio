import { NextRequest, NextResponse } from 'next/server'
import { fetchKlines } from '@/lib/yahoo-finance'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const ticker = searchParams.get('ticker')?.toUpperCase()
  const interval = (searchParams.get('interval') ?? '1d') as '1d' | '1w'
  const days = parseInt(searchParams.get('days') ?? '365', 10)

  if (!ticker) {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 })
  }

  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error

  try {
    const period1 = new Date()
    period1.setDate(period1.getDate() - days)
    const klines = await fetchKlines(ticker, interval, period1)
    return NextResponse.json(klines)
  } catch (err) {
    console.error('[/api/klines]', err)
    return NextResponse.json({ error: 'Failed to fetch klines' }, { status: 500 })
  }
}
