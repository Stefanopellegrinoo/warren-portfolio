// Explorer filter, sort and URL state (pure). Filters are AND-combined; rows
// without a value never match a numeric bound and always sort last.
import type { OnListRow, RateType } from './on-analytics'

export interface ExplorerFilters {
  q: string
  issuer: string
  currency: string // currencyLabel: 'USD MEP' | 'USD cable' | 'ARS' | ...
  law: '' | 'ARG' | 'NY'
  rateType: '' | RateType
  maturityFrom: string // ISO date or ''
  maturityTo: string
  ytmMin: number | null // percent
  ytmMax: number | null
  mdMin: number | null // years
  mdMax: number | null
}

export type SortKey = 'ticker' | 'issuer' | 'maturity' | 'price' | 'ytm' | 'md' | 'paridad' | 'cy' | 'wal' | 'adtv' | 'spread'

export interface ExplorerState {
  filters: ExplorerFilters
  sort: { key: SortKey; dir: 'asc' | 'desc' }
}

export const DEFAULT_STATE: ExplorerState = {
  filters: { q: '', issuer: '', currency: '', law: '', rateType: '', maturityFrom: '', maturityTo: '', ytmMin: null, ytmMax: null, mdMin: null, mdMax: null },
  sort: { key: 'adtv', dir: 'desc' }, // most liquid first
}

const NUM_KEYS = ['ytmMin', 'ytmMax', 'mdMin', 'mdMax'] as const
const TEXT_KEYS = ['q', 'issuer', 'currency', 'maturityFrom', 'maturityTo'] as const
const SORT_KEYS: SortKey[] = ['ticker', 'issuer', 'maturity', 'price', 'ytm', 'md', 'paridad', 'cy', 'wal', 'adtv', 'spread']
const RATE_TYPES: RateType[] = ['fixed', 'step', 'zero', 'floating', 'other']
const ISO = /^\d{4}-\d{2}-\d{2}$/

// A row without trades today shows no TIR in the list: its hidden value is null for sorting and filtering.
const tirOf = (r: OnListRow): number | null => (r.priceQuality === 'no-trades' ? null : r.ytmPct)

const SORTERS: Record<SortKey, (r: OnListRow) => number | string | null> = {
  ticker: (r) => r.tickerO,
  issuer: (r) => r.issuer,
  maturity: (r) => r.maturityDate,
  price: (r) => r.price,
  ytm: (r) => tirOf(r),
  md: (r) => r.mdYears,
  paridad: (r) => r.paridadPct,
  cy: (r) => r.currentYieldPct,
  wal: (r) => r.walYears,
  adtv: (r) => r.adtvUsd,
  spread: (r) => r.spreadBp,
}

const within = (v: number | null, min: number | null, max: number | null): boolean =>
  (min === null && max === null) || (v !== null && (min === null || v >= min) && (max === null || v <= max))

function matches(r: OnListRow, f: ExplorerFilters): boolean {
  const q = f.q.trim().toLowerCase()
  if (q && ![r.tickerO, r.tickerD, r.issuer, r.isin].some((s) => s?.toLowerCase().includes(q))) return false
  if (f.issuer && r.issuer !== f.issuer) return false
  if (f.currency && r.currencyLabel !== f.currency) return false
  if (f.law && r.law !== f.law) return false
  if (f.rateType && r.rateType !== f.rateType) return false
  if (f.maturityFrom && r.maturityDate < f.maturityFrom) return false
  if (f.maturityTo && r.maturityDate > f.maturityTo) return false
  return within(tirOf(r), f.ytmMin, f.ytmMax) && within(r.mdYears, f.mdMin, f.mdMax)
}

function compare(a: number | string | null, b: number | string | null, dir: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0
  if (a === null) return 1 // nulls last in both directions
  if (b === null) return -1
  const c = typeof a === 'string' || typeof b === 'string' ? String(a).localeCompare(String(b), 'es') : a - b
  return dir === 'asc' ? c : -c
}

export function applyExplorer(rows: OnListRow[], state: ExplorerState): OnListRow[] {
  const get = SORTERS[state.sort.key]
  return rows
    .filter((r) => matches(r, state.filters))
    .sort((a, b) => compare(get(a), get(b), state.sort.dir) || a.tickerO.localeCompare(b.tickerO))
}

export function issuersOf(rows: OnListRow[]): string[] {
  return [...new Set(rows.map((r) => r.issuer).filter((i): i is string => !!i))].sort((a, b) => a.localeCompare(b, 'es'))
}

// odd/tasks/ux-ons-y-operaciones.md S4: the search box is always visible; the rest of the
// filters sit behind one "Filtros" control that shows how many of these are set.
const PANEL_KEYS = ['issuer', 'currency', 'law', 'rateType', 'maturityFrom', 'maturityTo', 'ytmMin', 'ytmMax', 'mdMin', 'mdMax'] as const

export const activeFilterCount = (f: ExplorerFilters): number =>
  PANEL_KEYS.filter((k) => f[k] !== DEFAULT_STATE.filters[k]).length

/** One-tap shortcuts, each a plain patch of the filters above (so they travel in the URL like any filter). */
export interface ExplorerPreset {
  id: 'mep' | 'ny' | 'short'
  label: string
  patch: (today: string) => Partial<ExplorerFilters>
}

/** ISO date two years after `today`; 29 February falls back to the 28th. */
const inTwoYears = (today: string): string => {
  const md = today.slice(5) === '02-29' ? '02-28' : today.slice(5)
  return `${Number(today.slice(0, 4)) + 2}-${md}`
}

export const PRESETS: ExplorerPreset[] = [
  { id: 'mep', label: 'Pagan en dólar MEP', patch: () => ({ currency: 'USD MEP' }) },
  { id: 'ny', label: 'Ley Nueva York', patch: () => ({ law: 'NY' }) },
  { id: 'short', label: 'Vencen en 2 años o menos', patch: (today) => ({ maturityTo: inTwoYears(today) }) },
]

export const presetActive = (f: ExplorerFilters, p: ExplorerPreset, today: string): boolean =>
  Object.entries(p.patch(today)).every(([k, v]) => f[k as keyof ExplorerFilters] === v)

/** The patch a tap applies: the preset's values, or back to the defaults of those fields when it was on. */
export function togglePreset(f: ExplorerFilters, p: ExplorerPreset, today: string): Partial<ExplorerFilters> {
  const patch = p.patch(today)
  if (!presetActive(f, p, today)) return patch
  return Object.fromEntries(Object.keys(patch).map((k) => [k, DEFAULT_STATE.filters[k as keyof ExplorerFilters]]))
}

export function serializeExplorerQuery(s: ExplorerState): string {
  const p = new URLSearchParams()
  for (const k of TEXT_KEYS) if (s.filters[k]) p.set(k, s.filters[k])
  if (s.filters.law) p.set('law', s.filters.law)
  if (s.filters.rateType) p.set('rateType', s.filters.rateType)
  for (const k of NUM_KEYS) if (s.filters[k] !== null) p.set(k, String(s.filters[k]))
  if (s.sort.key !== DEFAULT_STATE.sort.key || s.sort.dir !== DEFAULT_STATE.sort.dir) {
    p.set('sort', s.sort.key)
    p.set('dir', s.sort.dir)
  }
  return p.toString()
}

export function parseExplorerQuery(query: string | { toString(): string }): ExplorerState {
  const p = new URLSearchParams(query.toString())
  const filters: ExplorerFilters = { ...DEFAULT_STATE.filters }
  for (const k of ['q', 'issuer', 'currency'] as const) filters[k] = p.get(k) ?? ''
  for (const k of ['maturityFrom', 'maturityTo'] as const) {
    const v = p.get(k) ?? ''
    filters[k] = ISO.test(v) ? v : ''
  }
  const law = p.get('law')
  filters.law = law === 'ARG' || law === 'NY' ? law : ''
  const rt = p.get('rateType') as RateType | null
  filters.rateType = rt && RATE_TYPES.includes(rt) ? rt : ''
  for (const k of NUM_KEYS) {
    const raw = p.get(k)
    const n = raw === null || raw.trim() === '' ? NaN : Number(raw)
    filters[k] = Number.isFinite(n) ? n : null
  }
  const key = p.get('sort') as SortKey | null
  const sort = key && SORT_KEYS.includes(key)
    ? { key, dir: p.get('dir') === 'desc' ? ('desc' as const) : ('asc' as const) }
    : DEFAULT_STATE.sort
  return { filters, sort }
}
