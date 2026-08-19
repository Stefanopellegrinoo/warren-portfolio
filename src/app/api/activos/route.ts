import { NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { normalizeError } from '@/lib/errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createServerClientInstance()
    
    const { data, error } = await supabase
      .from('activos')
      .select('ticker, nombre')
      .order('ticker')

    if (error) throw normalizeError(error)

    return NextResponse.json(data ?? [])
  } catch (err) {
    console.error('Error fetching activos:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}