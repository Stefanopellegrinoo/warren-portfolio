/**
 * READ-ONLY diagnostic — is every recorded transaction price on the SAME scale
 * as the historical price Yahoo would return for that ticker on that date?
 *
 * WHY: Yahoo's historical `close` is split-adjusted. A price recorded before a
 * split is not. Backfilling portfolio_snapshots with Yahoo closes would then
 * value a position against a cost basis on a different scale — a well-formed,
 * plausible, catastrophically wrong number (NVIDIA at $189 vs an adjusted $17
 * reads as -90%). This probe measures the scale factor per transaction so the
 * question is settled with data instead of remembered quotes.
 *
 * Reads the DB (SELECT only) and calls Yahoo Finance. Writes nothing, anywhere
 * — it deliberately bypasses fetchHistoricalQuotes so neither the Redis cache
 * nor that function's error-swallowing catch is involved.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase env vars.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

/** Company names typed into the ticker field. Mapping confirmed by price range. */
const NAME_TO_SYMBOL: Record<string, string> = {
  DISNEY: 'DIS', EXXON: 'XOM', FORD: 'F', GOOGLE: 'GOOGL',
  NIKE: 'NKE', NVIDIA: 'NVDA', PAYPAL: 'PYPL', TESLA: 'TSLA',
}

/** Test account — impossible states, seed rows, no transactions behind them. */
const TEST_USER = '94b2edc8-5376-4233-87b4-e650c0d97b92'

let yahooInstance: any = null
async function getYahoo(): Promise<any> {
  if (yahooInstance) return yahooInstance
  const mod = await import('yahoo-finance2')
  const YF = (mod as any).default || mod
  const instance = typeof YF === 'function' ? new YF() : YF
  if (typeof instance.suppressNotices === 'function') instance.suppressNotices(['yahooSurvey'])
  yahooInstance = instance
  return instance
}

interface Bar { date: string; close: number; adjClose: number | null }

/**
 * Historical bars, raw. Throws on failure — a fetch error must never be
 * mistaken for "this ticker has no price", which is the whole point here.
 */
async function fetchBars(symbol: string, from: Date, to: Date): Promise<Bar[]> {
  const yf = await getYahoo()

  try {
    const res = await yf.chart(symbol, { period1: from, period2: to, interval: '1d' })
    const quotes = res?.quotes ?? []
    if (quotes.length > 0) {
      return quotes
        .filter((q: any) => q?.date && q?.close != null)
        .map((q: any) => ({
          date: new Date(q.date).toISOString().slice(0, 10),
          close: Number(q.close),
          adjClose: q.adjclose != null ? Number(q.adjclose) : (q.adjClose != null ? Number(q.adjClose) : null),
        }))
    }
  } catch {
    // fall through to the legacy endpoint the repo already uses
  }

  const rows = await yf.historical(symbol, { period1: from, period2: to, interval: '1d' })
  return (rows ?? []).map((r: any) => ({
    date: new Date(r.date).toISOString().slice(0, 10),
    close: Number(r.close),
    adjClose: r.adjClose != null ? Number(r.adjClose) : null,
  }))
}

/** Close on `date`, else the most recent close before it (weekends/holidays). */
function closeOnOrBefore(bars: Bar[], date: string): Bar | null {
  let best: Bar | null = null
  for (const b of bars) {
    if (b.date <= date && (!best || b.date > best.date)) best = b
  }
  return best
}

/** What a scale factor means. Split ratios are the named ones. */
function verdictFor(ratio: number): string {
  if (ratio > 0.93 && ratio < 1.07) return 'OK (same scale)'
  const SPLITS: Array<[number, string]> = [
    [2, '2:1'], [3, '3:1'], [4, '4:1'], [5, '5:1'], [10, '10:1'], [20, '20:1'], [30, '30:1'],
  ]
  for (const [n, label] of SPLITS) {
    if (ratio > n * 0.93 && ratio < n * 1.07) return `UNADJUSTED — pre-split ${label}`
    if (ratio > (1 / n) * 0.93 && ratio < (1 / n) * 1.07) return `INVERSE ${label} — recorded BELOW Yahoo`
  }
  return `MISMATCH ×${ratio.toFixed(3)} — not a clean split ratio`
}

const short = (id: string) => String(id).slice(0, 8)

async function main() {
  const { data: txs, error } = await supabase
    .from('transactions')
    .select('id, user_id, date, ticker, operation, quantity, price, commission, asset_type, moneda, created_at')
    .neq('user_id', TEST_USER)
    .order('date', { ascending: true })

  if (error) throw new Error(error.message)

  const { data: catalog } = await supabase.from('ticker_identity').select('ticker, yahoo_symbol')
  const catalogMap = new Map((catalog ?? []).map((c: any) => [c.ticker, c.yahoo_symbol]))

  // ── PART 1: PAYPAL vs PYPL, row by row ───────────────────────────────────
  console.log(`\n${'='.repeat(96)}`)
  console.log('PART 1 — PAYPAL vs PYPL, individual rows (is it one position recorded twice?)')
  console.log('='.repeat(96))
  const pp = (txs ?? []).filter(t => t.ticker === 'PAYPAL' || t.ticker === 'PYPL')
  if (pp.length === 0) {
    console.log('\n(none found)')
  } else {
    console.log('\nTICKER   DATE        OP      QUANTITY       PRICE    COMMISSION         TOTAL   CREATED AT')
    console.log('-'.repeat(96))
    for (const t of pp) {
      const total = Number(t.quantity) * Number(t.price) + Number(t.commission ?? 0)
      console.log(
        `${t.ticker.padEnd(8)} ${t.date}  ${String(t.operation).padEnd(7)} ` +
        `${Number(t.quantity).toFixed(4).padStart(12)} ${Number(t.price).toFixed(2).padStart(11)} ` +
        `${Number(t.commission ?? 0).toFixed(2).padStart(13)} ${total.toFixed(2).padStart(13)}   ${t.created_at}`
      )
    }
  }

  // ── PART 2: recorded price vs Yahoo close, per transaction ───────────────
  const stockTxs = (txs ?? []).filter(t => (t.asset_type ?? 'ACCION') !== 'ON')

  const bySymbol = new Map<string, { symbol: string; rows: any[] }>()
  const unmappable: string[] = []

  for (const t of stockTxs) {
    const ticker = String(t.ticker).toUpperCase()
    const symbol = NAME_TO_SYMBOL[ticker] ?? catalogMap.get(ticker) ?? ticker
    if (ticker.startsWith('BCBA:')) { unmappable.push(ticker); continue }
    const entry = bySymbol.get(symbol) ?? { symbol, rows: [] }
    entry.rows.push(t)
    bySymbol.set(symbol, entry)
  }

  console.log(`\n\n${'='.repeat(96)}`)
  console.log(`PART 2 — recorded price vs Yahoo split-adjusted close (${bySymbol.size} symbols, ${stockTxs.length} transactions)`)
  console.log('='.repeat(96))

  const problems: string[] = []
  const fetchFailures: string[] = []

  for (const { symbol, rows } of Array.from(bySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    const dates = rows.map(r => r.date).sort()
    const from = new Date(dates[0])
    from.setDate(from.getDate() - 10)
    const to = new Date(dates[dates.length - 1])
    to.setDate(to.getDate() + 5)

    const tickersUsed = Array.from(new Set(rows.map(r => String(r.ticker).toUpperCase())))
    const label = tickersUsed.join(',') + (tickersUsed.includes(symbol) ? '' : ` -> ${symbol}`)

    let bars: Bar[]
    try {
      bars = await fetchBars(symbol, from, to)
    } catch (err: any) {
      console.log(`\n${label}  !! YAHOO FETCH FAILED: ${err?.message ?? err}`)
      fetchFailures.push(`${label}: ${err?.message ?? err}`)
      continue
    }

    if (bars.length === 0) {
      console.log(`\n${label}  !! NO BARS RETURNED for ${symbol} in ${dates[0]}..${dates[dates.length - 1]}`)
      fetchFailures.push(`${label}: no bars`)
      continue
    }

    console.log(`\n${label}   (${bars.length} bars)`)
    console.log('   USER      DATE        OP       RECORDED    YAHOO CLOSE   ADJCLOSE     RATIO  VERDICT')
    console.log('   ' + '-'.repeat(91))

    for (const r of rows) {
      const bar = closeOnOrBefore(bars, r.date)
      if (!bar) {
        console.log(`   ${short(r.user_id)}  ${r.date}  ${String(r.operation).padEnd(7)} ` +
                    `${Number(r.price).toFixed(2).padStart(10)}      (no bar on/before this date)`)
        problems.push(`${label} ${r.date}: no bar`)
        continue
      }
      const ratio = Number(r.price) / bar.close
      const verdict = verdictFor(ratio)
      if (!verdict.startsWith('OK')) problems.push(`${label} ${r.date}: ${verdict} (recorded ${Number(r.price).toFixed(2)}, yahoo ${bar.close.toFixed(2)})`)
      console.log(
        `   ${short(r.user_id)}  ${r.date}  ${String(r.operation).padEnd(7)} ` +
        `${Number(r.price).toFixed(2).padStart(10)} ${bar.close.toFixed(2).padStart(14)} ` +
        `${(bar.adjClose != null ? bar.adjClose.toFixed(2) : '-').padStart(10)} ${ratio.toFixed(3).padStart(9)}  ${verdict}`
      )
    }

    await new Promise(res => setTimeout(res, 250))
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n\n${'='.repeat(96)}`)
  console.log('SUMMARY')
  console.log('='.repeat(96))
  console.log(`\nTransactions checked : ${stockTxs.length} (ONs excluded — Yahoo has no such instrument)`)
  console.log(`Symbols fetched      : ${bySymbol.size}`)
  console.log(`Yahoo fetch failures : ${fetchFailures.length}`)
  fetchFailures.forEach(f => console.log(`   - ${f}`))
  console.log(`\nScale problems       : ${problems.length}`)
  problems.forEach(p => console.log(`   - ${p}`))
  if (problems.length === 0) console.log('   (none — every recorded price matches Yahoo on the same scale)')
  if (unmappable.length) console.log(`\nBCBA tickers skipped : ${Array.from(new Set(unmappable)).join(', ')}`)

  console.log('\nDone. Read-only — nothing was written to the DB, Redis or Yahoo.\n')
}

main().catch(err => {
  console.error('FAILED:', err)
  process.exit(1)
})
