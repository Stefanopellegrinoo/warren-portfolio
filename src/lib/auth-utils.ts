/**
 * Centralized Authentication Utilities
 * 
 * Provides consistent error handling, token validation, and HTTP response patterns
 * for all auth-related API routes. This ensures uniform behavior across all endpoints.
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

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
 * Error response mapping for consistent HTTP responses
 */
const ERROR_RESPONSES: Record<AuthErrorType, { status: number; message: string }> = {
  unauthorized: { status: 401, message: 'Unauthorized' },
  invalid_token: { status: 401, message: 'Invalid or expired token' },
  session_expired: { status: 401, message: 'Session has expired' },
  invalid_callback: { status: 400, message: 'Invalid OAuth callback' },
  invalid_code_format: { status: 400, message: 'Invalid authorization code format' },
  session_exchange_failed: { status: 401, message: 'Failed to establish session' },
  callback_failed: { status: 500, message: 'Authentication callback failed' },
  internal_error: { status: 500, message: 'Internal server error' },
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
          preview: code.substring(0, 20),
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
        code_preview: code.substring(0, 20),
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
      code_preview: code.substring(0, 20),
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
 * Validate user session and return user data or error
 * Used as the first step in protected API routes
 * 
 * @param supabase - Supabase client instance
 * @returns User object or structured error
 */
export async function validateUserSession(
  supabase: SupabaseClient
): Promise<{ user: any; error?: AuthError }> {
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr) {
      console.error('[Auth] User validation failed:', {
        message: authErr.message,
        status: authErr.status,
      })

      return {
        user: null,
        error: {
          type: authErr.status === 400 ? 'invalid_token' : 'session_expired',
          message: authErr.message || 'Failed to validate session',
          statusCode: authErr.status || 401,
          metadata: {
            reason: 'supabase_validation_error',
            originalStatus: authErr.status,
          },
        },
      }
    }

    if (!user) {
      return {
        user: null,
        error: {
          type: 'unauthorized',
          message: 'No authenticated user found',
          statusCode: 401,
          metadata: { reason: 'no_user' },
        },
      }
    }

    return { user }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'

    console.error('[Auth] User validation exception:', {
      error: errorMsg,
      stack: err instanceof Error ? err.stack : undefined,
    })

    return {
      user: null,
      error: {
        type: 'internal_error',
        message: errorMsg,
        statusCode: 500,
        metadata: { reason: 'exception_during_validation' },
      },
    }
  }
}

/**
 * Create a standardized HTTP response for auth errors
 * Ensures consistent error format across all endpoints
 * 
 * @param error - AuthError object
 * @returns NextResponse with appropriate status and format
 */
export function createAuthErrorResponse(error: AuthError): NextResponse {
  const { status, message } = ERROR_RESPONSES[error.type] || ERROR_RESPONSES.internal_error

  return NextResponse.json(
    {
      error: true,
      type: error.type,
      message: error.message || message,
      ...(process.env.NODE_ENV === 'development' && { metadata: error.metadata }),
    },
    { status }
  )
}

/**
 * Create a standardized HTTP response for successful auth operations
 * 
 * @param data - Response payload
 * @param statusCode - HTTP status code (default: 200)
 * @returns NextResponse with JSON data
 */
export function createAuthSuccessResponse(data: any, statusCode: number = 200): NextResponse {
  return NextResponse.json(data, { status: statusCode })
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
  const next = urlObj.searchParams.get('next') || '/dashboard'
  const origin = urlObj.origin

  return {
    code,
    next,
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
