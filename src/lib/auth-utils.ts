/**
 * Authentication utilities for the auth routes: authorization-code validation,
 * session exchange and callback parsing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { safeNextPath } from '@/lib/login-redirect'

/**
 * Auth error response types for consistent handling
 */
export type AuthErrorType =
  | 'unauthorized'
  | 'invalid_token'
  | 'session_expired'
  | 'invalid_callback'
  | 'invalid_code_format'
  | 'session_exchange_failed'
  | 'callback_failed'
  | 'internal_error'

/**
 * Structured auth error with consistent metadata
 */
export interface AuthError {
  type: AuthErrorType
  message: string
  statusCode: number
  metadata?: Record<string, any>
}

/**
 * Parse and validate an OAuth/authorization code
 * 
 * @param code - The authorization code from OAuth provider
 * @returns Validation result with error details if invalid
 */
export function validateAuthCode(code: string | null): { valid: boolean; error?: AuthError } {
  if (!code) {
    return {
      valid: false,
      error: {
        type: 'invalid_callback',
        message: 'Authorization code is missing',
        statusCode: 400,
        metadata: { reason: 'code_missing' },
      },
    }
  }

  // Basic format validation: code should be reasonably long and not contain obvious errors
  if (code.length < 10 || code.length > 500) {
    return {
      valid: false,
      error: {
        type: 'invalid_code_format',
        message: 'Authorization code has invalid format',
        statusCode: 400,
        metadata: {
          reason: 'invalid_format',
          length: code.length,
        },
      },
    }
  }

  return { valid: true }
}

/**
 * Exchange an authorization code for a session using Supabase
 * Handles all error cases consistently
 * 
 * @param supabase - Supabase client instance
 * @param code - Authorization code from OAuth provider
 * @returns Session result or structured error
 */
export async function exchangeCodeForSession(
  supabase: SupabaseClient,
  code: string
): Promise<{ success: boolean; error?: AuthError }> {
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[Auth] Session exchange failed:', {
        message: error.message,
        status: error.status,
      })

      return {
        success: false,
        error: {
          type: 'session_exchange_failed',
          message: error.message || 'Failed to exchange code for session',
          statusCode: error.status || 401,
          metadata: {
            reason: 'supabase_error',
            originalStatus: error.status,
          },
        },
      }
    }

    return { success: true }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'

    console.error('[Auth] Code exchange exception:', {
      error: errorMsg,
      stack: err instanceof Error ? err.stack : undefined,
    })

    return {
      success: false,
      error: {
        type: 'callback_failed',
        message: errorMsg,
        statusCode: 500,
        metadata: {
          reason: 'exception_during_exchange',
        },
      },
    }
  }
}

/**
 * Parse OAuth callback query parameters with validation
 * Returns origin and next URL for safe redirects
 * 
 * @param url - Full request URL
 * @returns Parsed parameters with validation
 */
export function parseCallbackParams(url: string): {
  code: string | null
  next: string
  origin: string
  error: AuthError | null
} {
  const urlObj = new URL(url)
  const code = urlObj.searchParams.get('code')
  const origin = urlObj.origin

  return {
    code,
    next: safeNextPath(urlObj.searchParams.get('next'), origin),
    origin,
    error: null,
  }
}

/**
 * Create a safe redirect URL for auth errors
 * Ensures redirect URLs are within the app domain
 * 
 * @param origin - Application origin
 * @param path - Target path
 * @param error - Auth error type (optional)
 * @returns Safe redirect URL
 */
export function createAuthRedirectUrl(
  origin: string,
  path: string,
  error?: AuthErrorType
): URL {
  const url = new URL(path, origin)
  if (error) {
    url.searchParams.set('error', error)
  }
  return url
}
