import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies as getCookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Structured JSON logging utility for cookie operations
 * Provides production-grade observability for authentication flows
 */
interface CookieLog {
  timestamp: string
  level: 'error' | 'warn' | 'info'
  action: 'set' | 'remove' | 'get'
  cookieName: string
  context: string
  errorMessage?: string
  errorType?: string
  errorStack?: string
  environment: string
}

/**
 * Log cookie operation with structured JSON for production compatibility
 */
function logCookieOperation(log: CookieLog) {
  // Add to log for external monitoring (DataDog, CloudWatch, etc.)
  if (log.level === 'error') {
    console.error(JSON.stringify(log));
  } else if (log.level === 'warn') {
    console.warn(JSON.stringify(log));
  } else {
    console.info(JSON.stringify(log));
  }
}

/**
 * Extract error details for structured logging
 */
function extractErrorDetails(error: unknown): { message: string; type: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      type: error.name || 'Error',
      stack: error.stack,
    };
  }
  return {
    message: String(error),
    type: typeof error,
  };
}

/**
 * Create Supabase client for Middleware contexts.
 * Uses req/res cookie manipulation for middleware-specific needs.
 */
export function createSupabaseServerClient(req: NextRequest, res: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { 
          return req.cookies.get(name)?.value; 
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            res.cookies.set({ name, value, ...options });
          } catch (error) {
            const errorDetails = extractErrorDetails(error);
            logCookieOperation({
              timestamp: new Date().toISOString(),
              level: 'error',
              action: 'set',
              cookieName: name,
              context: 'middleware',
              errorMessage: errorDetails.message,
              errorType: errorDetails.type,
              errorStack: errorDetails.stack,
              environment: process.env.NODE_ENV || 'unknown',
            });
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            res.cookies.set({ name, value: '', ...options });
          } catch (error) {
            const errorDetails = extractErrorDetails(error);
            logCookieOperation({
              timestamp: new Date().toISOString(),
              level: 'error',
              action: 'remove',
              cookieName: name,
              context: 'middleware',
              errorMessage: errorDetails.message,
              errorType: errorDetails.type,
              errorStack: errorDetails.stack,
              environment: process.env.NODE_ENV || 'unknown',
            });
          }
        },
      },
    }
  );
}

/**
 * Create Supabase client for Route Handlers and Server Components.
 * Uses cookies() from next/headers for automatic session management in request handlers.
 * This is the preferred method for API routes and server-side functions.
 */
export function createServerClientInstance() {
  const cookieStore = getCookies();
  
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set(name, value, options);
          } catch (error) {
            const errorDetails = extractErrorDetails(error);
            logCookieOperation({
              timestamp: new Date().toISOString(),
              level: 'error',
              action: 'set',
              cookieName: name,
              context: 'server-component',
              errorMessage: errorDetails.message,
              errorType: errorDetails.type,
              errorStack: errorDetails.stack,
              environment: process.env.NODE_ENV || 'unknown',
            });
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.delete(name);
          } catch (error) {
            const errorDetails = extractErrorDetails(error);
            logCookieOperation({
              timestamp: new Date().toISOString(),
              level: 'error',
              action: 'remove',
              cookieName: name,
              context: 'server-component',
              errorMessage: errorDetails.message,
              errorType: errorDetails.type,
              errorStack: errorDetails.stack,
              environment: process.env.NODE_ENV || 'unknown',
            });
          }
        },
      },
    }
  );
}
/**
 * Create Supabase service client using service role key.
 * Used for background jobs and privileged operations that bypass RLS.
 * Should only be used in secure server-side contexts.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Export cookie logging utility for use in other parts of the application
 */
export { logCookieOperation, extractErrorDetails, type CookieLog };
