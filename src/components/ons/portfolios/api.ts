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
      // The session expired: send the user to log in instead of showing a dead form.
      if (typeof window !== 'undefined') window.location.assign('/auth/login')
      return { ok: false, status: 401, error: 'Tu sesión venció. Iniciá sesión de nuevo.' }
    }
    if (!res.ok) return { ok: false, status: res.status, error: typeof data?.error === 'string' ? data.error : 'No se pudo completar la operación' }
    return { ok: true, status: res.status, data: data as T }
  } catch {
    return { ok: false, status: 0, error: 'No se pudo conectar. Revisá tu conexión y reintentá.' }
  }
}
