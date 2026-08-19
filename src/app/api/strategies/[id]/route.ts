import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import type { Strategy } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireUser()
    if (isAuthFailure(auth)) return auth.error
    const { supabase, user } = auth

    const { data, error } = await supabase
      .from('strategies')
      .select('*, indicator_setups(*)')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true, referencedTable: 'indicator_setups' })
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 })
    }

    return NextResponse.json({ strategy: data })
  } catch (err: unknown) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireUser()
    if (isAuthFailure(auth)) return auth.error
    const { supabase, user } = auth

    const body = (await req.json()) as Record<string, unknown>

    const updates: Partial<Pick<Strategy, 'name' | 'philosophy' | 'tickers' | 'timeframes' | 'active'>> = {}

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
      }
      updates.name = (body.name as string).trim()
    }

    if (body.philosophy !== undefined) {
      if (typeof body.philosophy !== 'string' || body.philosophy.trim().length === 0) {
        return NextResponse.json({ error: 'philosophy must be a non-empty string' }, { status: 400 })
      }
      updates.philosophy = (body.philosophy as string).trim()
    }

    if (body.tickers !== undefined) {
      updates.tickers = Array.isArray(body.tickers) ? body.tickers : []
    }

    if (body.timeframes !== undefined) {
      updates.timeframes = Array.isArray(body.timeframes) ? body.timeframes : []
    }

    if (body.active !== undefined) {
      updates.active = Boolean(body.active)
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('strategies')
      .update(updates)
      .eq('id', params.id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ strategy: data as Strategy })
  } catch (err: unknown) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireUser()
    if (isAuthFailure(auth)) return auth.error
    const { supabase, user } = auth

    const { data, error } = await supabase
      .from('strategies')
      .delete()
      .eq('id', params.id)
      .eq('user_id', user.id)
      .select('id')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return new NextResponse(null, { status: 204 })
  } catch (err: unknown) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
