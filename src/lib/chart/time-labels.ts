import { TickMarkType } from 'lightweight-charts'

/**
 * How the chart writes a bar's time (odd/tasks/chart-display.md S1, S4). Daily, weekly and monthly bars
 * are calendar days stored at UTC midnight (`toChartTime`): they are read in UTC, since Buenos Aires
 * (UTC−3) would show the day before. Intraday bars are instants: the crosshair and the axis hours read
 * them in Buenos Aires time, on a 24-hour clock. The library places day, month and year ticks at UTC
 * midnights (weightByTime), so those keep its UTC labels: a Buenos Aires name there would be the day before.
 * ponytail: those ticks sit 3 h before the Buenos Aires midnight; exact local ticks need shifted bar times.
 */
const TZ = 'America/Argentina/Buenos_Aires'
const fmt = (timeZone: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-AR', { timeZone, hourCycle: 'h23', ...opts })

const DAY = fmt('UTC', { day: 'numeric', month: 'short', year: 'numeric' })
const DAY_TIME = fmt(TZ, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
// The intraday axis hours in Buenos Aires time, with the library's own look ("13:00").
const HOURS: Partial<Record<TickMarkType, Intl.DateTimeFormat>> = {
  [TickMarkType.Time]: fmt(TZ, { hour: '2-digit', minute: '2-digit' }),
  [TickMarkType.TimeWithSeconds]: fmt(TZ, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
}

const toDate = (time: number) => new Date(time * 1000)

/** The crosshair's label for the bar at `time` (chart seconds). */
export function crosshairLabel(time: number, intraday: boolean): string {
  return (intraday ? DAY_TIME : DAY).format(toDate(time))
}

/** An axis label: an intraday hour in Buenos Aires time; null otherwise, so the library keeps its own (UTC) label. */
export function tickLabel(time: number, type: TickMarkType, intraday: boolean): string | null {
  const hours = intraday ? HOURS[type] : undefined
  return hours ? hours.format(toDate(time)) : null
}
