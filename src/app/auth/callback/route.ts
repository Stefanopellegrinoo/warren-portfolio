import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/dashboard'

  // Validation: Ensure code is present
  if (!code) {
    console.warn('[Auth] OAuth callback missing code parameter')
    return NextResponse.redirect(
      new URL('/auth/login?error=invalid_callback', origin)
    )
  }

  // Validation: Basic code format check (should be non-empty string)
  if (code.length < 10 || code.length > 500) {
    console.warn('[Auth] Invalid OAuth code format:', {
      length: code.length,
      preview: code.substring(0, 20),
    })
    return NextResponse.redirect(
      new URL('/auth/login?error=invalid_code_format', origin)
    )
  }

  try {
    const supabase = createServerClientInstance()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[Auth] Session exchange failed:', {
        message: error.message,
        status: error.status,
        code: code.substring(0, 20),
      })
      return NextResponse.redirect(
        new URL(
          `/auth/login?error=${encodeURIComponent(error.message)}`,
          origin
        )
      )
    }

    // Success: Redirect to intended destination
    return NextResponse.redirect(new URL(next, origin))
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Auth] Callback error:', {
      error: errorMsg,
      code: code.substring(0, 20),
      stack: err instanceof Error ? err.stack : undefined,
    })

    return NextResponse.redirect(
      new URL('/auth/login?error=callback_failed', origin)
    )
  }
}

