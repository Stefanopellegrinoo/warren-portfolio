import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Normalize any throwable into a proper Error instance with a preserved message.
 *
 * PostgrestError-like objects returned by Supabase RPC come as deserialized
 * plain objects, so `instanceof Error` is false. This utility extracts their
 * message and carries the original value in `{ cause }` for debugging.
 */
export function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err

  // PostgrestError-like plain object from Supabase RPC
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const pe = err as PostgrestError
    return new Error(pe.message, { cause: pe })
  }

  // Plain object with a message property (validation errors, etc.)
  if (err && typeof err === 'object' && 'message' in err) {
    return new Error(String((err as { message: unknown }).message), { cause: err })
  }

  // Primitives, null, undefined
  return new Error(String(err), { cause: err })
}
