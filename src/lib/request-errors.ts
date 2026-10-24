export const NO_CONNECTION = 'No hay conexión. Revisá tu internet y probá de nuevo.'

/** A Spanish message for a failed request, never the browser's "Failed to fetch". */
export function requestErrorMessage(err: unknown, fallback: string): string {
  // fetch throws TypeError when the request never reached the server.
  if (err instanceof TypeError) return NO_CONNECTION
  // A non-JSON body (an HTML error page) says nothing useful to the user.
  if (err instanceof SyntaxError) return fallback
  // Errors the app throws carry the server's message, already in Spanish.
  return err instanceof Error && err.message ? err.message : fallback
}
