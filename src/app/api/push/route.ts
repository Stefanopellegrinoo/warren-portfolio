import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { serverError } from '@/lib/api/errors'
import { validateRequest, validationErrorResponse } from '@/lib/api/validation'
import { PUSH_NOT_CONFIGURED, PushSubscriptionSchema, PushUnsubscribeSchema } from '@/lib/schemas/push'

// The public VAPID key, read at runtime so the image needs no rebuild when it changes.
export async function GET() {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const publicKey = process.env.VAPID_PUBLIC_KEY
  if (!publicKey) return NextResponse.json({ error: PUSH_NOT_CONFIGURED }, { status: 503 })
  return NextResponse.json({ publicKey })
}

// Saves this device for the signed-in user; subscribing again only refreshes its keys.
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  const { supabase, user } = auth

  try {
    const { endpoint, keys } = await validateRequest(PushSubscriptionSchema, req)
    const { error } = await supabase.from('push_subscriptions').upsert(
      { user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null },
      { onConflict: 'user_id,endpoint' },
    )
    if (error) return serverError('API /push', error)
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error: any) {
    if (error?.status === 400) return validationErrorResponse(error)
    return serverError('API /push', error)
  }
}

// Forgets this device: it stops receiving the user's notifications.
export async function DELETE(req: NextRequest) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  const { supabase, user } = auth

  try {
    const { endpoint } = await validateRequest(PushUnsubscribeSchema, req)
    const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint)
    if (error) return serverError('API /push', error)
    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    if (error?.status === 400) return validationErrorResponse(error)
    return serverError('API /push', error)
  }
}
