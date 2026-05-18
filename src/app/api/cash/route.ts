import { NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { processCashMovement } from '@/lib/cash-engine'
import { validateRequest, validationErrorResponse } from '@/lib/api/validation'
import { CashMovementSchema } from '@/lib/schemas/cash'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = createServerClientInstance()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Validate request body
    const body = await validateRequest(CashMovementSchema, request)
    
    // Process the movement
    const result = await processCashMovement(supabase, user.id, body)
    return NextResponse.json(result)
  } catch (error: any) {
    // Handle validation errors
    if (error.status === 400) {
      return validationErrorResponse(error)
    }
    
    // Handle other errors
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  const supabase = createServerClientInstance()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: balance } = await supabase
    .from('cash_balance')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({ balance: balance ?? null })
}
