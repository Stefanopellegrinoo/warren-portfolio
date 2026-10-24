'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cachedValue, load } from '@/lib/client-cache'

/**
 * useCached for data a page flips between (a tab, a benchmark pick; odd/tasks/rendimiento.md S9): each key is
 * asked once per visit. Its remembered value shows at once and refreshes behind the first time; coming back to it
 * during the same visit asks nothing. A failed key stays failed until `reload`.
 */
export function useCachedPerVisit<T>(key: string | null, fetcher: () => Promise<T>) {
  const fetcherRef = useRef(fetcher)
  useLayoutEffect(() => {
    fetcherRef.current = fetcher
  })
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  // The keys answered during this visit, with their failure if they failed.
  const [answers, setAnswers] = useState<Record<string, { error: unknown }>>({})
  const answer = key ? answers[key] : undefined

  useEffect(() => {
    if (!key || answer) return
    const done = (error: unknown) => { if (mounted.current) setAnswers(a => ({ ...a, [key]: { error } })) }
    load(key, () => fetcherRef.current()).then(() => done(null), done)
  }, [key, answer])

  return {
    data: key ? cachedValue<T>(key) : undefined,
    error: answer?.error ?? null,
    loading: !!key && !answer,
    reload: () => {
      if (!key) return
      setAnswers(a => {
        const next = { ...a }
        delete next[key]
        return next
      })
    },
  }
}
