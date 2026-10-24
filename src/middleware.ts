import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from './lib/supabase-server';
import { loginPath } from './lib/login-redirect';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const pathname = req.nextUrl.pathname;

  const protectedPaths = ['/dashboard', '/history', '/cashflow', '/statistics', '/strategies', '/ons', '/trading'];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
  const isAuthPage = pathname === '/auth/login' || pathname === '/';

  if (!isProtected && !isAuthPage) return res;

  const supabase = createSupabaseServerClient(req, res);
  const { data: { session } } = await supabase.auth.getSession();

  if (!session && isProtected) {
    // An auth cookie that no longer yields a session means it expired, not that the user never signed in.
    // Sign-up leaves a PKCE `-auth-token-code-verifier` cookie behind; that is not a session.
    const expired = req.cookies.getAll().some((c) =>
      c.name.startsWith('sb-') && c.name.includes('-auth-token') && !c.name.endsWith('-code-verifier'));
    return NextResponse.redirect(new URL(loginPath(pathname + req.nextUrl.search, expired), req.url));
  }

  if (session && isAuthPage) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  return res;
}

export const config = {
  matcher: [
    '/',
    '/auth/login',
    '/dashboard/:path*',
    '/history/:path*',
    '/cashflow/:path*',
    '/statistics/:path*',
    '/strategies/:path*',
    '/ons/:path*',
    '/trading/:path*',
  ],
};
