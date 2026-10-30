import type { SearchResult } from '@/lib/market-data/types'

// The market (Yahoo) ticker search, shared by the chart's symbol search and the shell's asset search.

export function buildSearchUrl(q: string): string {
  return `/api/ticker/search?q=${encodeURIComponent(q)}`
}

/** Rejects when the search failed, with the server's message when it sent one: a failure is not "no results". */
export async function fetchTickerSearch(q: string): Promise<SearchResult[]> {
  const res = await fetch(buildSearchUrl(q))
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) throw new Error(data?.error ?? '')
  return data.results ?? []
}

export function shouldFetchSearch(query: string): boolean {
  return query.length >= 2
}
