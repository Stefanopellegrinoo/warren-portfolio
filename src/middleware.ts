import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from './lib/supabase-server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const pathname = req.nextUrl.pathname;

  const protectedPaths = ['/dashboard', '/history', '/cashflow', '/statistics', '/strategies'];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
  const isAuthPage = pathname === '/auth/login' || pathname === '/';

  if (!isProtected && !isAuthPage) return res;

  const supabase = createSupabaseServerClient(req, res);
  const { data: { session } } = await supabase.auth.getSession();

  if (!session && isProtected) {
    return NextResponse.redirect(new URL('/auth/login', req.url));
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
  ],
};
