import { TickMarkType } from 'lightweight-charts'

/**
 * How the chart writes a bar's time (odd/tasks/chart-display.md S1, S4). Daily, weekly and monthly bars
 * are calendar days stored at UTC midnight (`toChartTime`): they are read in UTC, since Buenos Aires
 * (UTC−3) would show the day before. Intraday bars are instants: they are read in Buenos Aires time, on
 * the crosshair and on the axis alike, always on a 24-hour clock.
 */
const TZ = 'America/Argentina/Buenos_Aires'
const fmt = (timeZone: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-AR', { timeZone, hourCycle: 'h23', ...opts })

const DAY = fmt('UTC', { day: 'numeric', month: 'short', year: 'numeric' })
const DAY_TIME = fmt(TZ, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
// The intraday axis in Buenos Aires time, with the library's own look (a day number, a short month, "13:00").
const TICK: Record<TickMarkType, Intl.DateTimeFormat> = {
  [TickMarkType.Year]: fmt(TZ, { year: 'numeric' }),
  [TickMarkType.Month]: fmt(TZ, { month: 'short' }),
  [TickMarkType.DayOfMonth]: fmt(TZ, { day: 'numeric' }),
  [TickMarkType.Time]: fmt(TZ, { hour: '2-digit', minute: '2-digit' }),
  [TickMarkType.TimeWithSeconds]: fmt(TZ, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
}

const toDate = (time: number) => new Date(time * 1000)

/** The crosshair's label for the bar at `time` (chart seconds). */
export function crosshairLabel(time: number, intraday: boolean): string {
  return (intraday ? DAY_TIME : DAY).format(toDate(time))
}

/** An axis label: Buenos Aires time on intraday charts; null elsewhere, so the library keeps its own (UTC) labels. */
export function tickLabel(time: number, type: TickMarkType, intraday: boolean): string | null {
  return intraday ? TICK[type].format(toDate(time)) : null
}
