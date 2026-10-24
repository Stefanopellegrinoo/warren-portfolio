import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { normalizeError } from '@/lib/errors'
import type { IndicatorSetup } from '@/types'
import { serverError } from '@/lib/api/errors'

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
      .from('indicator_setups')
      .select('*')
      .eq('strategy_id', params.id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    if (error) throw normalizeError(error)

    return NextResponse.json({ setups: (data ?? []) as IndicatorSetup[] })
  } catch (err: unknown) {
    return serverError('API /strategies/[id]/setups', err)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireUser()
    if (isAuthFailure(auth)) return auth.error
    const { supabase, user } = auth

    const body = (await req.json()) as Record<string, unknown>

    const { name, config } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Ingresá un nombre para el setup' }, { status: 400 })
    }

    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return NextResponse.json({ error: 'Falta la configuración del setup' }, { status: 400 })
    }

    const configObj = config as Record<string, unknown>

    if (!Array.isArray(configObj.indicators)) {
      return NextResponse.json({ error: 'La configuración del setup no tiene indicadores' }, { status: 400 })
    }

    if (!configObj.conditions || typeof configObj.conditions !== 'object') {
      return NextResponse.json({ error: 'La configuración del setup no tiene condiciones' }, { status: 400 })
    }

    // Verify the strategy belongs to the user before inserting
    const { data: strategy, error: strategyError } = await supabase
      .from('strategies')
      .select('id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (strategyError || !strategy) {
      return NextResponse.json({ error: 'No encontramos esa estrategia' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('indicator_setups')
      .insert({
        user_id: user.id,
        strategy_id: params.id,
        name: (name as string).trim(),
        config: config as object,
      })
      .select()
      .single()

    if (error) throw normalizeError(error)

    return NextResponse.json({ setup: data as IndicatorSetup }, { status: 201 })
  } catch (err: unknown) {
    return serverError('API /strategies/[id]/setups', err)
  }
}
