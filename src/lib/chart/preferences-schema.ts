import { z } from 'zod'
import type { DrawingKind, DrawingStyle } from 'lightweight-charts-drawing'
import type { IndicatorConfig, IndicatorKey } from '@/lib/store/chart-store'

/**
 * The chart preferences kept in the account (odd/tasks/chart-customization.md S4, migration 051):
 * favorite drawing tools, the style last chosen per tool, and the indicator settings the user saved.
 * Each section is a map by key: a change merges per key (a null removes the key), so one device's
 * change never wipes another key changed elsewhere. Which indicators are on or hidden, and where the
 * favorites bar sits, stay on the device and are not here.
 *
 * Shared by the API (the trust boundary: every write is validated here) and the client (its device
 * copy is validated on read too). Plain module: no "use client" imports, so the route can use it.
 */

/** The tools of the Dibujar list (`GROUPS` in DrawingTools.tsx), in its order; a test keeps them equal. */
export const TOOL_KINDS = [
  'trend-line', 'ray', 'extended-line', 'horizontal-line', 'horizontal-ray', 'vertical-line',
  'parallel-channel', 'fib-retracement', 'trend-based-fib-extension',
  'rectangle', 'brush', 'text',
  'price-range', 'date-and-price-range', 'long-position', 'short-position',
] as const satisfies readonly DrawingKind[]
export type ToolKind = (typeof TOOL_KINDS)[number]

export const INDICATOR_KEYS = [
  'ema20', 'ema50', 'ema200', 'rsi', 'macd', 'volume', 'bollinger', 'obv', 'stochastic', 'adx',
] as const satisfies readonly IndicatorKey[]
// Compile-time: a new IndicatorKey must be listed above.
const everyIndicator: Exclude<IndicatorKey, (typeof INDICATOR_KEYS)[number]> extends never ? true : never = true
void everyIndicator

/** The IndicatorConfig fields each indicator uses and their bounds (the clamps of IndicatorSettingsDialog). */
export const INDICATOR_VALUE_BOUNDS: Record<IndicatorKey, Partial<Record<keyof IndicatorConfig, readonly [number, number]>>> = {
  ema20: { ema20: [2, 500] },
  ema50: { ema50: [2, 500] },
  ema200: { ema200: [2, 500] },
  rsi: { rsi: [2, 100] },
  macd: { macdFast: [2, 100], macdSlow: [2, 200], macdSignal: [2, 100] },
  volume: {},
  bollinger: { bbPeriod: [2, 500], bbStdDev: [1, 5] },
  obv: {},
  stochastic: { stochK: [1, 100], stochSmooth: [1, 20], stochD: [1, 20] },
  adx: { adxPeriod: [2, 100] },
}

/** A remembered style: the subset of the library's DrawingStyle the user last chose for a tool. */
export type RememberedStyle = Partial<DrawingStyle>

/** One line of an indicator; T5 names the lines (upper, signal, histogramUp, …). */
export interface IndicatorLineStyle { color?: string; width?: number; visible?: boolean }
export interface IndicatorStyle {
  lines?: Record<string, IndicatorLineStyle>
  levels?: { value: number; color?: string; visible?: boolean }[]
  fills?: Record<string, { visible?: boolean; color?: string; transparency?: number }>
  [field: string]: unknown
}
export interface IndicatorSettings { values?: Partial<IndicatorConfig>; style?: IndicatorStyle }

export interface ChartPreferences {
  /** Starred tools; only `true` is stored. The bar shows them in TOOL_KINDS order. */
  favorites: Partial<Record<ToolKind, true>>
  toolStyles: Partial<Record<ToolKind, RememberedStyle>>
  /** An indicator absent here uses this device's values (the account starts empty). */
  indicatorSettings: Partial<Record<IndicatorKey, IndicatorSettings>>
}
/** A change: per key, the new value, or null to remove it. */
export interface PreferencesPatch {
  favorites?: Partial<Record<ToolKind, true | null>>
  toolStyles?: Partial<Record<ToolKind, RememberedStyle | null>>
  indicatorSettings?: Partial<Record<IndicatorKey, IndicatorSettings | null>>
}

export const EMPTY_PREFERENCES: ChartPreferences = Object.freeze({ favorites: {}, toolStyles: {}, indicatorSettings: {} })

// Size bounds: one entry ≤ 4 KB (the largest factory style, fib retracement, is ~1.3 KB), and a body
// holding every entry at its maximum still fits MAX_BODY_BYTES, so a valid outbox is never refused.
// Migration 051 caps each stored section at 128 KB as well, for rows written around this API.
export const MAX_ENTRY_BYTES = 4096
export const MAX_BODY_BYTES = 128 * 1024
const MAX_TEXT = 300
const MAX_ITEMS = 64

const COLOR_RE = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:\d*\.)?\d+\s*)?\))$/i
const KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,39}$/
// Fields the library reads as a color: color, textColor, stopColor, sectorColor1, successBackground, …
const COLOR_FIELD_RE = /(?:^c|C)olor\d?$|Background$/

const color = z.string().max(40).regex(COLOR_RE)
const flag = z.boolean().optional()
const leaf = z.union([z.boolean(), z.number().min(-1e9).max(1e9), z.string().max(MAX_TEXT)])
const container = (inner: z.ZodType) => z.union([leaf, z.array(inner).max(MAX_ITEMS), z.record(z.string().regex(KEY_RE), inner)])
// Two levels of nesting cover every DrawingStyle field of the app's tools (levels: [{coeff, color}]).
const openValue = container(container(leaf))
const lineStyle = z.enum(['solid', 'dashed', 'dotted'])
const percent = z.number().min(0).max(100)

const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

/**
 * Field names are identifiers and every string in a color field is a color, at any depth; the entry fits
 * MAX_ENTRY_BYTES. Checked on the input, not zod's output: zod turns a JSON "__proto__" field into the
 * output's prototype, where a check of the output never sees it.
 */
function plainEntry(value: unknown): boolean {
  const walk = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.every(walk)
    if (!v || typeof v !== 'object') return true
    return Object.entries(v).every(([k, x]) => KEY_RE.test(k) && (typeof x !== 'string' || !COLOR_FIELD_RE.test(k) || COLOR_RE.test(x)) && walk(x))
  }
  return walk(value) && byteSize(value) <= MAX_ENTRY_BYTES
}

// The fields every tool shares are typed; the rest of DrawingStyle is open but bounded.
const drawingStyle = z
  .object({
    color: color.optional(),
    width: z.number().min(1).max(10).optional(),
    lineStyle: lineStyle.optional(),
    textColor: color.optional(),
    backgroundColor: color.optional(),
    fillBackground: flag,
    transparency: percent.optional(),
    extendLeft: flag,
    extendRight: flag,
    middleLine: flag,
    fontSize: z.number().min(6).max(72).optional(),
    text: z.string().max(MAX_TEXT).optional(),
    levels: z
      .array(z.strictObject({
        coeff: z.number().min(-1000).max(1000),
        color,
        visible: z.boolean(),
        label: z.string().max(MAX_TEXT).optional(),
        width: z.number().min(1).max(10).optional(),
        style: lineStyle.optional(),
        text: z.string().max(MAX_TEXT).optional(),
      }))
      .max(MAX_ITEMS)
      .optional(),
  })
  .catchall(openValue)

const fieldMap = <T extends z.ZodType>(value: T) => z.record(z.string().regex(KEY_RE), value)
// Open for T5, which defines the exact lines, levels and fills of each indicator.
const indicatorStyle = z
  .object({
    lines: fieldMap(z.strictObject({ color: color.optional(), width: z.number().int().min(1).max(4).optional(), visible: flag })).optional(),
    levels: z.array(z.strictObject({ value: z.number().min(-1e9).max(1e9), color: color.optional(), visible: flag })).max(8).optional(),
    fills: fieldMap(z.strictObject({ visible: flag, color: color.optional(), transparency: percent.optional() })).optional(),
  })
  .catchall(openValue)

const indicatorSchemas = new Map<string, z.ZodType>(
  INDICATOR_KEYS.map((key) => {
    const values = z.strictObject(
      Object.fromEntries(Object.entries(INDICATOR_VALUE_BOUNDS[key]).map(([field, [min, max]]) => [field, z.number().min(min).max(max).optional()])),
    )
    return [key, z.strictObject({ values: values.optional(), style: indicatorStyle.optional() })]
  }),
)
const toolKinds = new Set<string>(TOOL_KINDS)
const favorite = z.literal(true)

const SECTIONS = ['favorites', 'toolStyles', 'indicatorSettings'] as const
type Section = (typeof SECTIONS)[number]
type Entries = Record<string, unknown>

function entrySchema(section: Section, key: string): z.ZodType | undefined {
  if (section === 'indicatorSettings') return indicatorSchemas.get(key)
  if (!toolKinds.has(key)) return undefined
  return section === 'favorites' ? favorite : drawingStyle
}

const isMap = (v: unknown): v is Entries => !!v && typeof v === 'object' && !Array.isArray(v)

/** The valid entries of each section; `strict` answers null at the first unknown or invalid thing instead. */
function read(raw: unknown, removals: boolean, strict: boolean): Record<Section, Entries> | null {
  const out: Record<Section, Entries> = { favorites: {}, toolStyles: {}, indicatorSettings: {} }
  if (!isMap(raw)) return strict ? null : out
  if (strict && Object.keys(raw).some((s) => !(SECTIONS as readonly string[]).includes(s))) return null
  for (const section of SECTIONS) {
    const entries = raw[section]
    if (entries === undefined) continue
    if (!isMap(entries)) { if (strict) return null; continue }
    for (const [key, value] of Object.entries(entries)) {
      const schema = entrySchema(section, key)
      if (schema && removals && value === null) { out[section][key] = null; continue }
      const parsed = schema && plainEntry(value) ? schema.safeParse(value) : undefined
      if (parsed?.success) out[section][key] = parsed.data
      else if (strict) return null
    }
  }
  return out
}

/** Stored or cached preferences, keeping only what the app knows (a row may be written around the API). */
export function parsePreferences(raw: unknown): ChartPreferences {
  return read(raw, false, false) as unknown as ChartPreferences
}

/** A patch names only the sections it changes. */
function compact(sections: Record<Section, Entries>): PreferencesPatch {
  return Object.fromEntries(Object.entries(sections).filter(([, entries]) => Object.keys(entries).length > 0))
}

/** A PATCH body as the API accepts it, or null when any section, key or value is not one it knows. */
export function parsePatch(raw: unknown): PreferencesPatch | null {
  const sections = read(raw, true, true)
  return sections && compact(sections)
}

/** The valid part of a change (a consumer's call, the device's outbox). */
export function cleanPatch(raw: unknown): PreferencesPatch {
  return compact(read(raw, true, false)!)
}

export function isEmptyPatch(patch: PreferencesPatch): boolean {
  return SECTIONS.every((s) => Object.keys(patch[s] ?? {}).length === 0)
}

/** `later` wins per key; a null (removal) is kept so it reaches the account. */
export function mergePatch(earlier: PreferencesPatch, later: PreferencesPatch): PreferencesPatch {
  const out: PreferencesPatch = {}
  for (const s of SECTIONS) {
    if (earlier[s] || later[s]) (out as Record<Section, Entries>)[s] = { ...earlier[s], ...later[s] }
  }
  return out
}

/** The preferences after a change, as a new object. */
export function applyPatch(prefs: ChartPreferences, patch: PreferencesPatch): ChartPreferences {
  const next = { ...prefs } as Record<Section, Entries>
  for (const s of SECTIONS) {
    const changes = patch[s] as Entries | undefined
    if (!changes) continue
    const merged: Entries = { ...next[s] }
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) delete merged[key]
      else merged[key] = value
    }
    next[s] = merged
  }
  return next as unknown as ChartPreferences
}
