import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return req.cookies.get(name)?.value },
        set(name: string, value: string, options: any) { res.cookies.set({ name, value, ...options }) },
        remove(name: string, options: any) { res.cookies.set({ name, value: '', ...options }) },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()
  const pathname = req.nextUrl.pathname

  // Redirect to login if not authenticated on protected routes
  if (!session && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/auth/login', req.url))
  }
  if (!session && pathname.startsWith('/history')) {
    return NextResponse.redirect(new URL('/auth/login', req.url))
  }
  if (!session && pathname.startsWith('/cashflow')) {
    return NextResponse.redirect(new URL('/auth/login', req.url))
  }

  // Redirect to dashboard if already logged in
  if (session && pathname === '/auth/login') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }
  if (session && pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return res
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/history/:path*', '/cashflow/:path*', '/auth/login'],
}
