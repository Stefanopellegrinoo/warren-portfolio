import { loginPath } from '@/lib/login-redirect'

// Tiny fetch wrapper for the test-portfolio routes: never throws, always returns a Spanish error message.
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string }

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
    if (res.status === 204) return { ok: true, status: 204, data: undefined as T }
    const data = await res.json().catch(() => null)
    if (res.status === 401) {
      // The session expired: send the user to log in, then back here, instead of showing a dead form.
      if (typeof window !== 'undefined') window.location.assign(loginPath(window.location.pathname + window.location.search, true))
      return { ok: false, status: 401, error: 'Tu sesión venció. Volvé a ingresar.' }
    }
    if (!res.ok) return { ok: false, status: res.status, error: typeof data?.error === 'string' ? data.error : 'No se pudo completar la operación' }
    return { ok: true, status: res.status, data: data as T }
  } catch {
    return { ok: false, status: 0, error: 'No se pudo conectar. Revisá tu conexión y reintentá.' }
  }
}

/** A failed request, thrown by `apiData`: its status and its Spanish message. */
export class ApiFailure extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** `api` for useCached (odd/tasks/rendimiento.md S9): the data, or a thrown ApiFailure, so a failure is never remembered. */
export async function apiData<T>(path: string): Promise<T> {
  const r = await api<T>(path)
  if (!r.ok) throw new ApiFailure(r.status, r.error)
  return r.data
}
