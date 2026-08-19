import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import type { IndicatorSetup, SetupConfig } from '@/types'

export const dynamic = 'force-dynamic'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; setupId: string } }
) {
  try {
    const auth = await requireUser()
    if (isAuthFailure(auth)) return auth.error
    const { supabase, user } = auth

    const body = (await req.json()) as Record<string, unknown>

    const updates: Partial<Pick<IndicatorSetup, 'name' | 'config' | 'active'>> = {}

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
      }
      updates.name = (body.name as string).trim()
    }

    if (body.config !== undefined) {
      const config = body.config as SetupConfig
      if (typeof config !== 'object' || !Array.isArray(config.indicators) || !config.conditions) {
        return NextResponse.json(
          { error: 'config must have indicators (array) and conditions' },
          { status: 400 }
        )
      }
      updates.config = config
    }

    if (body.active !== undefined) {
      updates.active = Boolean(body.active)
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('indicator_setups')
      .update(updates)
      .eq('id', params.setupId)
      .eq('strategy_id', params.id)
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

    return NextResponse.json({ setup: data as IndicatorSetup })
  } catch (err: unknown) {
    console.error(err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; setupId: string } }
) {
  try {
    const auth = await requireUser()
    if (isAuthFailure(auth)) return auth.error
    const { supabase, user } = auth

    const { data, error } = await supabase
      .from('indicator_setups')
      .delete()
      .eq('id', params.setupId)
      .eq('strategy_id', params.id)
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
