/**
 * READ-ONLY diagnosis of the duplicated closed_trades after the ticker repair.
 *
 * Hypothesis: the rows written by the bulk import carry transaction_id = NULL.
 * UNIQUE allows many NULLs, so rebuildClosedTrades' upsert (onConflict:
 * transaction_id) found no conflict and INSERTED alongside them instead of
 * updating — leaving the pre-repair row under its old ticker name.
 *
 * Prints every closed_trade on an affected ticker with its transaction_id and
 * whether that transaction still exists and is a VENTA. Writes nothing.
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const OLD = ['DISNEY', 'EXXON', 'FORD', 'GOOGLE', 'NIKE', 'NVIDIA', 'PAYPAL', 'TESLA']
const NEW = ['DIS', 'XOM', 'F', 'GOOGL', 'NKE', 'NVDA', 'PYPL', 'TSLA']
const ALL = [...OLD, ...NEW]

const n = (v: any) => Number(v ?? 0)
const short = (id: any) => (id == null ? '   NULL ' : String(id).slice(0, 8))

async function main() {
  const [closedRes, txRes] = await Promise.all([
    supabase.from('closed_trades').select('*').in('ticker', ALL).order('ticker'),
    supabase.from('transactions').select('id, ticker, operation, date').in('ticker', ALL),
  ])
  if (closedRes.error) throw new Error(closedRes.error.message)
  if (txRes.error) throw new Error(txRes.error.message)

  const closed = closedRes.data ?? []
  const txById = new Map((txRes.data ?? []).map((t: any) => [t.id, t]))

  console.log(`\n${'='.repeat(112)}`)
  console.log(`CLOSED TRADES on affected tickers — ${closed.length} rows`)
  console.log('='.repeat(112))
  console.log('\nTICKER   OPEN        CLOSE        QUANTITY   AVG_COST     INVESTED     PROCEEDS         PNL  TX_ID     TX STATUS')

  let oldSum = 0, newSum = 0, nullTx = 0
  for (const c of closed) {
    const pnl = n(c.proceeds) - n(c.invested)
    const isOld = OLD.includes(c.ticker)
    if (isOld) oldSum += pnl; else newSum += pnl
    if (c.transaction_id == null) nullTx++

    const tx = c.transaction_id ? txById.get(c.transaction_id) : null
    const status = c.transaction_id == null
      ? 'NO LINK (import-era row)'
      : tx
        ? `${tx.operation} ${tx.ticker} ${tx.date}`
        : 'LINKED TX NOT FOUND'

    console.log(
      `${String(c.ticker).padEnd(8)} ${c.open_date}  ${c.close_date}  ${n(c.quantity).toFixed(4).padStart(11)} ` +
      `${n(c.avg_cost).toFixed(2).padStart(10)} ${n(c.invested).toFixed(2).padStart(12)} ${n(c.proceeds).toFixed(2).padStart(12)} ` +
      `${pnl.toFixed(2).padStart(11)}  ${short(c.transaction_id)}  ${isOld ? '[STALE] ' : '[FRESH] '}${status}`
    )
  }

  console.log(`\n${'='.repeat(112)}`)
  console.log('DIAGNOSIS')
  console.log('='.repeat(112))
  console.log(`\n  rows with transaction_id = NULL : ${nullTx}   <-- these defeated the upsert's ON CONFLICT`)
  console.log(`  rows under an OLD ticker name   : ${closed.filter(c => OLD.includes(c.ticker)).length}   P&L ${oldSum.toFixed(4)}`)
  console.log(`  rows under a NEW ticker name    : ${closed.filter(c => NEW.includes(c.ticker)).length}   P&L ${newSum.toFixed(4)}`)
  console.log(`  total currently in the table    : ${(oldSum + newSum).toFixed(4)}`)
  console.log(`\n  expected after removing stale   : ${newSum.toFixed(4)}`)
  console.log('  (must equal the pre-repair 13232.9023)')

  const orphans = closed.filter(c => OLD.includes(c.ticker))
  const anyLiveTx = orphans.filter(c => c.transaction_id && txById.has(c.transaction_id))
  console.log(`\n  stale rows still linked to a live transaction: ${anyLiveTx.length}`)
  if (anyLiveTx.length > 0) {
    console.log('  !! Do NOT bulk-delete by ticker — some stale rows share a transaction with a fresh one.')
  } else {
    console.log('  Safe to delete every row whose ticker is one of the 8 old names:')
    console.log(`  ${OLD.join(', ')}`)
    console.log('  No transaction carries those strings any more, so nothing legitimate lives under them.')
  }

  const stillOld = (txRes.data ?? []).filter((t: any) => OLD.includes(t.ticker))
  console.log(`\n  transactions still carrying an old ticker string: ${stillOld.length}  (must be 0)`)

  console.log('\nDone. Read-only — nothing was modified.\n')
}

main().catch(err => { console.error('FAILED:', err); process.exit(1) })
