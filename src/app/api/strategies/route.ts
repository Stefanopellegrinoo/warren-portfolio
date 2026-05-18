import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import type { Strategy, StrategiesListResponse } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  try {
    const auth = await requireUser()
    if (isAuthFailure(auth)) return auth.error
    const { supabase, user } = auth

    const { data, error } = await supabase
      .from('strategies')
      .select('*, indicator_setups(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .order('created_at', { ascending: true, referencedTable: 'indicator_setups' })

    if (error) throw error

    const response: StrategiesListResponse = { strategies: data ?? [] }
    return NextResponse.json(response)
  } catch (err: unknown) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (isAuthFailure(auth)) return auth.error
    const { supabase, user } = auth

    const body = (await req.json()) as Record<string, unknown>

    const { name, philosophy, tickers, timeframes } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (!philosophy || typeof philosophy !== 'string' || philosophy.trim().length === 0) {
      return NextResponse.json({ error: 'philosophy is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('strategies')
      .insert({
        user_id: user.id,
        name: (name as string).trim(),
        philosophy: (philosophy as string).trim(),
        tickers: Array.isArray(tickers) ? tickers : [],
        timeframes: Array.isArray(timeframes) ? timeframes : [],
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ strategy: data as Strategy }, { status: 201 })
  } catch (err: unknown) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
