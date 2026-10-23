import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Daily reference dollar rates (MEP and CCL) in fx_rates, from argentinadatos.
 *
 * A trade in pesos or in one dollar needs the other rates of its own date to be
 * shown in all three currencies, and today's value needs today's. The rate of a
 * day is the average of its buy and sell close, as Cocos uses for its USD view.
 */

export type FxKind = 'mep' | 'ccl'

const BASE = 'https://api.argentinadatos.com/v1/cotizaciones/dolares'
export const FX_SERIES: Record<FxKind, string> = { mep: 'bolsa', ccl: 'contadoconliqui' }
const CHUNK = 1000
const FETCH_TIMEOUT_MS = 20_000

interface ArgentinaDatosRow {
  compra: number | null
  venta: number | null
  fecha: string
}

async function fetchSeries(kind: FxKind, fetchFn: typeof fetch) {
  const name = FX_SERIES[kind]
  const res = await fetchFn(`${BASE}/${name}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`argentinadatos ${name}: HTTP ${res.status}`)
  const rows = (await res.json()) as ArgentinaDatosRow[]
  return rows
    .filter((r) => (r.compra ?? 0) > 0 && (r.venta ?? 0) > 0)
    .map((r) => ({ date: r.fecha, kind, buy: r.compra as number, sell: r.venta as number, source: 'argentinadatos' }))
}

/** Upserts the whole MEP and CCL history (idempotent; a few thousand rows). */
export async function ingestFxRates(
  supabase: SupabaseClient,
  fetchFn: typeof fetch = fetch
): Promise<Record<FxKind, number>> {
  // Both series first: a failed fetch writes nothing.
  const [mep, ccl] = await Promise.all([fetchSeries('mep', fetchFn), fetchSeries('ccl', fetchFn)])
  const rows = [...mep, ...ccl]
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('fx_rates').upsert(rows.slice(i, i + CHUNK), { onConflict: 'date,kind' })
    if (error) throw new Error(`fx_rates upsert: ${error.message}`)
  }
  return { mep: mep.length, ccl: ccl.length }
}

/** The rate of a date, or of the last day before it with one (weekends, holidays). */
export async function getFxRate(
  supabase: SupabaseClient,
  date: string,
  kind: FxKind
): Promise<{ rate: number; date: string } | null> {
  const { data, error } = await supabase
    .from('fx_rates')
    .select('date, buy, sell')
    .eq('kind', kind)
    .lte('date', date)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`fx_rates read: ${error.message}`)
  if (!data) return null
  return { rate: (Number(data.buy) + Number(data.sell)) / 2, date: data.date }
}
