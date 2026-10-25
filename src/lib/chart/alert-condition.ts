import { z } from 'zod'
import type { Timeframe } from '../binance/types'
import type { IndicatorConfig, IndicatorKey } from '../store/chart-store'
import { INDICATOR_KEYS, INDICATOR_STYLE_PARTS, INDICATOR_VALUE_BOUNDS } from './preferences-schema'

/**
 * What an alert watches (odd/tasks/chart-customization.md S6, migration 052): a source (the price or an
 * indicator line) crossing a target (a value typed by hand, the price or another line) up, down or either
 * way. A condition with an indicator line keeps the chart's timeframe and the indicator periods of its
 * creation. An alert from before is the price against a value, up or down.
 *
 * Shared by the API (every write is validated here), the chart and the worker. Plain module with relative
 * imports only: the worker runs it with tsx, without the `@/` paths.
 */

/** The lines an alert can watch, `<indicator>.<line>`: the lines INDICATOR_STYLE_PARTS restyles, no histograms.
 *  Migration 052 lists the same; a test keeps them equal. */
export const ALERT_LINES: readonly string[] = INDICATOR_KEYS.flatMap((key) => (INDICATOR_STYLE_PARTS[key].lines ?? []).map((line) => `${key}.${line}`))
export const ALERT_OPERATORS = ['crosses_above', 'crosses_below', 'crosses'] as const
export type AlertOperator = (typeof ALERT_OPERATORS)[number]
/** The timeframes the chart offers (timeframes.ts, Yahoo's and Binance's together). */
export const ALERT_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'] as const satisfies readonly Timeframe[]
/** 'unavailable' is "No se puede revisar": the worker could not compute the condition (S7). */
export type AlertStatus = 'active' | 'triggered' | 'unavailable'
/** `type` predates conditions (026): the app only ever wrote 'price'. */
const ALERT_TYPES = ['price', 'rsi', 'ema20', 'ema50', 'macd_signal'] as const

export interface AlertCondition {
  /** 'price' or one of ALERT_LINES. */
  source: string
  operator: AlertOperator
  /** 'value', 'price' or one of ALERT_LINES; never the source. */
  target: string
  /** The value typed by hand; null against a line. */
  value: number | null
  timeframe: Timeframe | null
  periods: Partial<IndicatorConfig> | null
}

export const indicatorOf = (line: string) => line.split('.')[0] as IndicatorKey
export const lineIdOf = (line: string) => line.split('.')[1]

/** The indicators a condition computes, once each. */
export function indicatorsOf(c: Pick<AlertCondition, 'source' | 'target'>): IndicatorKey[] {
  return [...new Set([c.source, c.target].filter((s) => ALERT_LINES.includes(s)).map(indicatorOf))]
}

/** The price against a value: every alert from before, the only kind drawn on the price pane and dragged. */
export const isPriceValue = (c: Pick<AlertCondition, 'source' | 'target'>) => c.source === 'price' && c.target === 'value'

// ── Validation (the API's trust boundary) ────────────────────────────────────

export const ALERT_MAX_BODY_BYTES = 4096
export const ALERT_ERRORS = {
  required: 'Completá el ticker, el tipo, la condición, el valor y el nombre de la alerta',
  tooLarge: 'La alerta es demasiado grande para guardarla.',
  operator: 'Elegí cómo tiene que cruzar: para arriba, para abajo o cualquiera',
  value: 'El valor de la alerta tiene que ser un número',
  source: 'Elegí qué tiene que cruzar: el precio o una línea de un indicador',
  target: 'Elegí contra qué: un valor o otra línea',
  itself: 'Elegí otra línea: una línea no se cruza a sí misma',
  timeframe: 'Elegí uno de los intervalos del gráfico',
  periods: 'Los períodos del indicador no son válidos',
  color: 'Elegí un color de la paleta',
  name: 'El nombre de la alerta tiene que tener entre 1 y 200 caracteres',
  ticker: 'El ticker de la alerta no es válido',
  type: 'El tipo de alerta no es válido',
  condition: 'Revisá la condición de la alerta y probá de nuevo.',
  status: 'Solo se puede reactivar la alerta',
} as const

// A missing field says what is missing, as before; a wrong one says what to choose.
const or = (message: string) => (issue: { input?: unknown }) => (issue.input === undefined ? ALERT_ERRORS.required : message)
const operator = z.enum(ALERT_OPERATORS, { error: or(ALERT_ERRORS.operator) })
const value = z.number({ error: ALERT_ERRORS.value }).min(-1e12, { error: ALERT_ERRORS.value }).max(1e12, { error: ALERT_ERRORS.value })
const source = z.enum(['price', ...ALERT_LINES] as [string, ...string[]], { error: ALERT_ERRORS.source })
const target = z.enum(['value', 'price', ...ALERT_LINES] as [string, ...string[]], { error: ALERT_ERRORS.target })
const timeframe = z.enum(ALERT_TIMEFRAMES, { error: ALERT_ERRORS.timeframe }).nullable().optional()
const color = z.string().regex(/^#[0-9a-f]{6}$/i, { error: ALERT_ERRORS.color }).nullable().optional()
const name = z.string({ error: or(ALERT_ERRORS.name) }).trim().min(1, { error: ALERT_ERRORS.required }).max(200, { error: ALERT_ERRORS.name })

const conditionFields = {
  source: source.optional(),
  target: target.optional(),
  operator,
  value: value.nullable().optional(),
  timeframe,
  // Checked on the raw input by the condition below: zod's output turns a JSON "__proto__" key into a prototype.
  periods: z.unknown().optional(),
}

/** Exactly the period fields of the indicators a condition computes, within the settings' bounds. */
const periodsOf = (keys: IndicatorKey[]) =>
  z.strictObject(Object.fromEntries(keys.flatMap((k) => Object.entries(INDICATOR_VALUE_BOUNDS[k]).map(([f, [min, max]]) => [f, z.number().min(min).max(max)]))))

type ConditionInput = { source?: string; target?: string; operator: AlertOperator; value?: number | null; timeframe?: Timeframe | null; periods?: unknown }
type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/** One condition, whole: a value exactly against a value, the timeframe and periods exactly when a line is computed. */
function condition(input: ConditionInput): Result<AlertCondition> {
  const c = { source: input.source ?? 'price', target: input.target ?? 'value' }
  if (c.source === c.target) return { ok: false, error: ALERT_ERRORS.itself }
  const needed = indicatorsOf(c)
  if (c.target === 'value' && (input.value === undefined || input.value === null)) return { ok: false, error: ALERT_ERRORS.required }
  if (needed.length === 0) return { ok: true, data: { ...c, operator: input.operator, value: input.value ?? null, timeframe: null, periods: null } }
  if (!input.timeframe) return { ok: false, error: ALERT_ERRORS.timeframe }
  const periods = periodsOf(needed).safeParse(input.periods)
  if (!periods.success) return { ok: false, error: ALERT_ERRORS.periods }
  return {
    ok: true,
    data: { ...c, operator: input.operator, value: c.target === 'value' ? input.value! : null, timeframe: input.timeframe, periods: periods.data as Partial<IndicatorConfig> },
  }
}

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? ALERT_ERRORS.condition

const createSchema = z.object({
  ticker: z.string({ error: or(ALERT_ERRORS.ticker) }).trim().min(1, { error: ALERT_ERRORS.required }).max(40, { error: ALERT_ERRORS.ticker }),
  type: z.enum(ALERT_TYPES, { error: or(ALERT_ERRORS.type) }),
  name,
  color,
  ...conditionFields,
})

export interface AlertCreate extends AlertCondition {
  ticker: string
  type: (typeof ALERT_TYPES)[number]
  name: string
  color: string | null
}

/** A POST body: today's ({ticker, type, operator, value, name}) or with a condition and a color. */
export function parseAlertCreate(raw: unknown): Result<AlertCreate> {
  const parsed = createSchema.safeParse(raw ?? {})
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) }
  const { ticker, type, name, color = null } = parsed.data
  const c = condition(parsed.data)
  return c.ok ? { ok: true, data: { ticker, type, name, color, ...c.data } } : c
}

const updateSchema = z.object({
  name: name.optional(),
  channel: z.string().max(40).optional(),
  status: z.unknown().optional(),
  color,
  ...conditionFields,
  operator: operator.optional(),
})

const CONDITION_KEYS = ['source', 'target', 'timeframe', 'periods'] as const

/**
 * A PATCH body as the columns it changes. Today's (a moved value, an operator, a name, a rearm) changes
 * just those; a new condition comes whole (source, target, operator, value, timeframe, periods) and
 * replaces the old one; a color alone is a color.
 */
export function parseAlertUpdate(raw: unknown): Result<Record<string, unknown>> {
  const parsed = updateSchema.safeParse(raw ?? {})
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) }
  const { name, channel, status, color, operator, ...rest } = parsed.data
  if (status !== undefined && status !== 'active') return { ok: false, error: ALERT_ERRORS.status }
  const out: Record<string, unknown> = {}
  if (CONDITION_KEYS.some((k) => rest[k] !== undefined)) {
    if (!rest.source || !rest.target || !operator) return { ok: false, error: ALERT_ERRORS.condition }
    const c = condition({ ...rest, operator })
    if (!c.ok) return c
    Object.assign(out, c.data)
  } else {
    if (rest.value === null) return { ok: false, error: ALERT_ERRORS.value }
    if (operator !== undefined) out.operator = operator
    if (rest.value !== undefined) out.value = rest.value
  }
  if (name !== undefined) out.name = name
  if (channel !== undefined) out.channel = channel
  if (color !== undefined) out.color = color
  if (status === 'active') Object.assign(out, { status: 'active', triggered_at: null })
  return { ok: true, data: out }
}
