import { NextResponse } from 'next/server'
import { z, type ZodSchema } from 'zod'
import { GENERIC_ERROR } from './errors'
import '@/lib/schemas/locale'

/** The 400 for a body that is not valid JSON. */
export const INVALID_JSON = 'No se pudo leer el pedido. Recargá la página y probá de nuevo.'

/** The answer when the input is wrong but there is no field to name. */
export const INVALID_INPUT = 'Revisá los datos ingresados y probá de nuevo.'

/** The message of the first issue: the one the user sees. */
export function firstIssueMessage(error: unknown): string {
  return (error instanceof z.ZodError && error.issues[0]?.message) || INVALID_INPUT
}

function validationFailure(error: unknown) {
  const issues = error instanceof z.ZodError ? error.issues : []
  return {
    status: 400,
    message: firstIssueMessage(error),
    errors: issues.length
      ? issues.map(i => ({ path: i.path.map(String).join('.'), message: i.message }))
      : [{ message: INVALID_INPUT }],
  }
}

/**
 * Simple validation helper for route handlers
 */
export async function validateRequest<T>(schema: ZodSchema<T>, request: Request): Promise<T> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw { status: 400, message: INVALID_JSON, errors: [{ message: INVALID_JSON }] }
  }
  return validateBody(schema, body)
}

/** Same as validateRequest, for a body already read (a route choosing between schemas). */
export function validateBody<T>(schema: ZodSchema<T>, body: unknown): T {
  try {
    return schema.parse(body)
  } catch (error) {
    throw validationFailure(error)
  }
}

/**
 * Validate query parameters from URL
 */
export function validateQueryParams<T>(schema: ZodSchema<T>, url: string): T {
  const { searchParams } = new URL(url)
  return validateBody(schema, Object.fromEntries(searchParams.entries()))
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
  return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 })
}
