'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Responses remembered in this tab, by key (odd/tasks/rendimiento.md S6). A page that comes back
 * shows its last data at once and refreshes it behind (stale-while-revalidate), and components
 * asking for the same key at the same time share one request. Nothing is persisted: a reload of
 * the app starts empty.
 */
const store = new Map<string, unknown>()
const inflight = new Map<string, Promise<unknown>>()

export function cachedValue<T>(key: string): T | undefined {
  return store.get(key) as T | undefined
}

export function setCachedValue<T>(key: string, value: T): void {
  store.set(key, value)
}

/** Forgets the remembered responses whose key starts with `prefix` (all of them without one). */
export function forgetCached(prefix = ''): void {
  for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key)
}

/** One request per key at a time; a successful result is remembered, a failure is not. */
export function load<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const request = fetcher()
    .then((value) => {
      store.set(key, value)
      return value
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, request)
  return request
}

/**
 * The remembered value of `key` at once, if any, and a fresh load behind it. `loading` is true
 * until this visit's load answers; `data` keeps the remembered value meanwhile, and after a failed
 * refresh. A null key asks for nothing.
 */
export function useCached<T>(key: string | null, fetcher: () => Promise<T>) {
  const fetcherRef = useRef(fetcher)
  useLayoutEffect(() => {
    fetcherRef.current = fetcher
  })
  const [answer, setAnswer] = useState<{ key: string; data?: T; error?: unknown } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!key) return
    let live = true
    load(key, () => fetcherRef.current()).then(
      (data) => { if (live) setAnswer({ key, data }) },
      (error) => { if (live) setAnswer({ key, data: cachedValue<T>(key), error }) },
    )
    return () => { live = false }
  }, [key, attempt])

  const mine = answer?.key === key ? answer : null
  return {
    data: mine?.data ?? (key ? cachedValue<T>(key) : undefined),
    error: mine?.error ?? null,
    loading: !!key && !mine,
    reload: () => setAttempt((n) => n + 1),
    mutate: (value: T) => {
      if (!key) return
      store.set(key, value)
      setAnswer({ key, data: value })
    },
  }
}
