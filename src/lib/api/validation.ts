import { NextResponse } from 'next/server'
import type { ZodSchema } from 'zod'

/**
 * Simple validation helper for route handlers
 */
export async function validateRequest<T>(schema: ZodSchema<T>, request: Request): Promise<T> {
  const body = await request.json()
  
  try {
    return schema.parse(body)
  } catch (error: any) {
    const errors = error.errors?.map((err: any) => ({
      path: err.path.join('.'),
      message: err.message,
    })) || [{ message: 'Invalid request body' }]
    
    throw {
      status: 400,
      message: 'Validation failed',
      errors,
    }
  }
}

/**
 * Validate query parameters from URL
 */
export function validateQueryParams<T>(schema: ZodSchema<T>, url: string): T {
  const { searchParams } = new URL(url)
  const params = Object.fromEntries(searchParams.entries())
  
  try {
    return schema.parse(params)
  } catch (error: any) {
    const errors = error.errors?.map((err: any) => ({
      path: err.path.join('.'),
      message: err.message,
    })) || [{ message: 'Invalid query parameters' }]
    
    throw {
      status: 400,
      message: 'Validation failed',
      errors,
    }
  }
}

/**
 * Format validation errors for response
 */
export function validationErrorResponse(error: any): NextResponse {
  if (error.status === 400) {
    return NextResponse.json(
      {
        error: error.message,
        validationErrors: error.errors,
      },
      { status: 400 }
    )
  }
  
  // Default to 500
  console.error('Validation error:', error)
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  )
}