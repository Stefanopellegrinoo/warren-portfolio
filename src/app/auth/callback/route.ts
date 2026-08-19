import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import {
  validateAuthCode,
  exchangeCodeForSession,
  createAuthRedirectUrl,
  parseCallbackParams,
} from '@/lib/auth-utils'

export async function GET(req: NextRequest) {
  const { code, next, origin, error: _err } = parseCallbackParams(req.url)

  const codeValidation = validateAuthCode(code)
  if (!codeValidation.valid) {
    const error = codeValidation.error!
    console.warn('[Auth] Invalid code in callback:', {
      type: error.type,
      message: error.message,
      metadata: error.metadata,
    })
    const redirectUrl = createAuthRedirectUrl(origin, '/auth/login', error.type)
    return NextResponse.redirect(redirectUrl)
  }

  const supabase = createServerClientInstance()
  const exchangeResult = await exchangeCodeForSession(supabase, code!)

  if (!exchangeResult.success) {
    const error = exchangeResult.error!
    const redirectUrl = createAuthRedirectUrl(origin, '/auth/login', error.type)
    return NextResponse.redirect(redirectUrl)
  }

  return NextResponse.redirect(new URL(next, origin))
}

