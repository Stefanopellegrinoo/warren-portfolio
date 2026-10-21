// Argentine business-day calendar. Pure (no DB, no network) and timezone-safe:
// every date is an ISO 'YYYY-MM-DD' string handled through UTC arithmetic only.
//
// Holidays: weekends, fixed dates, Easter-based (Carnival, Good Friday),
// movable ones (Law 27.399 rule) and decreed bridge days. Decreed days are
// listed only for years published at
// https://www.argentina.gob.ar/interior/feriados-nacionales-2026
// Years without a decree list use the rule-based holidays only.
// ponytail: undecreed movable holidays in later years may be off by <=1 day on far flows.

export type Bdc = 'following' | 'modified_following' | 'preceding'

export interface Calendar {
  isBusinessDay(iso: string): boolean
  adjust(iso: string, bdc: Bdc): string
}

const DAY_MS = 86_400_000

// Decreed "dias no laborables con fines turisticos" (bank holidays).
const DECREED: Record<number, readonly string[]> = {
  2026: ['2026-03-23', '2026-07-10', '2026-12-07'],
}

// Fixed (inamovibles): month-day.
const FIXED = ['01-01', '03-24', '04-02', '05-01', '05-25', '06-20', '07-09', '12-08', '12-25']
// Movable (trasladables): Tue/Wed -> previous Monday, Thu/Fri -> next Monday.
const MOVABLE = ['06-17', '08-17', '10-12', '11-20']

function toMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: string, n: number): string {
  return fromMs(toMs(iso) + n * DAY_MS)
}

// 0 = Sunday .. 6 = Saturday
function weekday(iso: string): number {
  return new Date(toMs(iso)).getUTCDay()
}

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
function easter(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function moveMovable(iso: string): string {
  const wd = weekday(iso)
  if (wd === 2) return addDays(iso, -1)
  if (wd === 3) return addDays(iso, -2)
  if (wd === 4) return addDays(iso, 4)
  if (wd === 5) return addDays(iso, 3)
  return iso
}

const holidayCache = new Map<number, Set<string>>()

function holidaysOf(year: number): Set<string> {
  const cached = holidayCache.get(year)
  if (cached) return cached
  const easterDate = easter(year)
  const set = new Set<string>([
    ...FIXED.map((md) => `${year}-${md}`),
    ...MOVABLE.map((md) => moveMovable(`${year}-${md}`)),
    addDays(easterDate, -48), // Carnival Monday
    addDays(easterDate, -47), // Carnival Tuesday
    addDays(easterDate, -2), // Good Friday
    ...(DECREED[year] ?? []),
  ])
  holidayCache.set(year, set)
  return set
}

export function isBusinessDay(iso: string): boolean {
  const wd = weekday(iso)
  if (wd === 0 || wd === 6) return false
  return !holidaysOf(Number(iso.slice(0, 4))).has(iso)
}

function step(iso: string, dir: 1 | -1): string {
  let d = addDays(iso, dir)
  while (!isBusinessDay(d)) d = addDays(d, dir)
  return d
}

export function adjust(iso: string, bdc: Bdc): string {
  if (isBusinessDay(iso)) return iso
  if (bdc === 'preceding') return step(iso, -1)
  const next = step(iso, 1)
  if (bdc === 'modified_following' && next.slice(0, 7) !== iso.slice(0, 7)) return step(iso, -1)
  return next
}

export function addBusinessDays(iso: string, n: number): string {
  let d = iso
  for (let i = 0; i < n; i++) d = step(d, 1)
  return d
}

// Settlement is T+1 business day.
export function settlementDate(asOf: string): string {
  return addBusinessDays(asOf, 1)
}

export const arCalendar: Calendar = { isBusinessDay, adjust }
