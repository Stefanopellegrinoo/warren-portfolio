/**
 * Past ON closes from Rava into `on_price_history`. Rava's CSV is the raw traded
 * series (per 100 original VN, same dirty convention as Data912), unlike BYMA's
 * open historical-series, which is back-adjusted for every coupon and amortization
 * and must never be used for history (measured 2026-10-22, odd/tasks/nucleo-ledger.md L4).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const RAVA_URL = 'https://www.rava.com/perfil/descarga-historicos/'
const HEADER = 'especie,apertura,maximo,minimo,ultimo,fecha,volumen,cierre'
const CHUNK = 500

export interface RavaClose { date: string; close: number; volume: number }

/** Traded days only: `volumen=0` rows repeat the last close and are not a market price of that day. */
export function parseRavaHistory(csv: string): RavaClose[] {
  const [header, ...lines] = csv.replace(/^﻿/, '').trim().split('\n')
  if (!header?.startsWith(HEADER)) throw new Error(`unexpected Rava header: ${header?.slice(0, 80)}`)
  return lines.flatMap(l => {
    const f = l.split(',')
    const close = Number(f[7])
    const volume = Number(f[6])
    return close > 0 && volume > 0 ? [{ date: f[5], close, volume }] : []
  })
}

/**
 * Inserts the traded closes of `ticker` dated in [from, today). Today is left to the
 * nightly capture because Rava serves it intraday. Existing rows always win: a close
 * we captured ourselves is never overwritten. Returns rows sent; THROWS on HTTP/DB failure.
 */
export async function backfillOnPriceHistory(
  supabase: SupabaseClient, ticker: string, from: string, today: string,
): Promise<number> {
  const res = await fetch(RAVA_URL + encodeURIComponent(ticker), { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Rava ${res.status} for ${ticker}`)
  const rows = parseRavaHistory(await res.text())
    .filter(r => r.date >= from && r.date < today)
    .map(r => ({ ticker, price_date: r.date, close: r.close, volume: r.volume, source: 'rava' }))

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from('on_price_history')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'ticker,price_date', ignoreDuplicates: true })
    if (error) throw new Error(`on_price_history backfill failed: ${error.message}`)
  }
  return rows.length
}
