import { NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { normalizeError } from '@/lib/errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createServerClientInstance()
    
    const { data, error } = await supabase
      .from('cedears')
      .select('ticker, ratio, activos!inner(nombre)')
      .order('ticker')

    if (error) throw normalizeError(error)

    // Transformar para que nombre venga de la tabla activos
    const transformed = data?.map((c: any) => ({
      ticker: c.ticker,
      ratio: c.ratio,
      nombre: c.activos?.nombre ?? c.ticker
    })) ?? []

    return NextResponse.json(transformed)
  } catch (err) {
    console.error('Error fetching cedears:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}