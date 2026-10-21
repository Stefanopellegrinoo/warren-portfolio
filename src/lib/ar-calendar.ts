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

// Decreed "dias no laborables con fines turisticos". They are treated as
// NON-business days for settlement and payment (banks are closed).
// Sources: Decreto 106/2023 (2024), Decreto 1027/2024 (2025 and 2026).
// Decreto 614/2025 lets the government move weekend-falling movable holidays
// ad hoc, so years without a curated list below are rule-based approximations.
const DECREED: Record<number, readonly string[]> = {
  2024: ['2024-04-01', '2024-06-21', '2024-10-11'],
  2025: ['2025-05-02', '2025-08-15', '2025-11-21'],
  2026: ['2026-03-23', '2026-07-10', '2026-12-07'],
}

// Explicit per-year placement of a movable holiday (month-day -> actual date).
// 2025-10-12 fell on a Sunday and was moved to Friday (Resolucion JGM 139/2025).
const MOVED: Record<number, Record<string, string>> = {
  2025: { '10-12': '2025-10-10' },
}

// Fixed (inamovibles): month-day.
const FIXED = ['01-01', '03-24', '04-02', '05-01', '05-25', '06-20', '07-09', '12-08', '12-25']
// Holy Thursday is a non-working day, not a holiday: BYMA operates, so it is a business day here.
// Movable (trasladables): Tue/Wed -> previous Monday, Thu/Fri -> next Monday.
const MOVABLE = ['06-17', '08-17', '10-12', '11-20']

export function toMs(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) throw new Error(`invalid ISO date: ${iso}`)
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const ms = Date.UTC(y, m - 1, d)
  // Reject rolled-over dates such as 2026-02-30.
  if (new Date(ms).toISOString().slice(0, 10) !== iso) throw new Error(`invalid ISO date: ${iso}`)
  return ms
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
    ...MOVABLE.map((md) => MOVED[year]?.[md] ?? moveMovable(`${year}-${md}`)),
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

// Negative n steps backwards.
export function addBusinessDays(iso: string, n: number): string {
  let d = iso
  for (let i = 0; i < Math.abs(n); i++) d = step(d, n < 0 ? -1 : 1)
  return d
}

// Settlement is T+1 business day.
export function settlementDate(asOf: string): string {
  return addBusinessDays(asOf, 1)
}

export const arCalendar: Calendar = { isBusinessDay, adjust }
