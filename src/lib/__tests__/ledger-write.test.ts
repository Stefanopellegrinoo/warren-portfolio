// T5.1 (odd/tasks/nucleo-ledger.md S5): the write path validates with the ledger core and
// inserts ledger rows only. The fake throws on any access to the stored derived tables.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ invalidated: [] as string[] }))
vi.mock('../redis', () => ({
  isRedisReady: () => false, getRedis: () => null, SUMMARY_VERSION_TTL: 60,
  invalidateUserCache: async (id: string) => { h.invalidated.push(id) },
}))
vi.mock('../cache', () => ({ invalidateCacheKey: vi.fn() }))
vi.mock('../yahoo-finance', () => ({ fetchQuotesWithFallback: vi.fn(async () => new Map()) }))
vi.mock('../data912-client', () => ({ fetchONQuotesWithFallback: vi.fn(async () => new Map()) }))
vi.mock('../queue', () => ({ addPriceUpdateJob: vi.fn(async () => undefined), addRefreshSummaryJob: vi.fn(async () => undefined) }))
vi.mock('../supabase-server', () => ({ createServiceClient: () => ({ from: () => ({ upsert: async () => ({ error: null }) }) }) }))
vi.mock('../utils', async orig => ({ ...(await orig<object>()), argentinaDate: () => '2026-10-22' }))

import { processTransaction, processTransactionBatch } from '../portfolio-engine'
import { processONTransaction } from '../on-engine'
import { processCashMovement, adjustCashBalance, deleteCashMovement } from '../cash-engine'
import { OversellError, newOversell } from '../ledger-write'
import { writeSupabase } from './fixtures/ledger-write-supabase'

const U = 'u1'
const buy = (over: Record<string, unknown> = {}) => ({
  id: 'b1', user_id: U, ticker: 'AAPL', operation: 'COMPRA', quantity: 10, price: 100, commission: 0,
  date: '2026-01-05', asset_type: 'ACCION', created_at: '2026-01-05T10:00:00.000Z', ...over,
})
const stock = { date: '2026-02-01', ticker: 'aapl', operation: 'VENTA' as const, quantity: 4, price: 120, commission: 0, assetType: 'ACCION' as const }

beforeEach(() => { h.invalidated.length = 0 })

describe('processTransaction', () => {
  it('rejects a sale of more than held with a 400 Spanish error and inserts nothing', async () => {
    const sb = writeSupabase({ transactions: [buy()] })
    const err = await processTransaction(sb as never, U, { ...stock, quantity: 11 }).catch(e => e)
    expect(err).toBeInstanceOf(OversellError)
    expect(err.status).toBe(400)
    expect(err.message).toBe('No podés vender 11 AAPL el 2026-02-01: a esa fecha tenías 10.')
    expect(sb.rpcCalls).toEqual([])
    expect(sb.tables.transactions).toHaveLength(1)
    expect(sb.tables.cash_movements ?? []).toHaveLength(0)
  })

  it('a valid sale inserts only ledger rows and answers the position and sale from the core', async () => {
    const sb = writeSupabase({ transactions: [buy()] })
    const result = await processTransaction(sb as never, U, stock)
    expect(sb.tables.transactions).toHaveLength(2)
    expect(sb.tables.cash_movements).toMatchObject([{ type: 'VENTA', amount: 480 }])
    expect(result.transaction).toMatchObject({ ticker: 'AAPL', operation: 'VENTA', quantity: -4 })
    expect(result.position).toMatchObject({ ticker: 'AAPL', quantity: 6, avg_cost: 100 })
    expect(result.closedTrade).toMatchObject({ ticker: 'AAPL', quantity: 4, close_price: 120, pnl: 80 })
  })

  it('a buy needs no validation read and answers position with no closed trade', async () => {
    const sb = writeSupabase()
    const result = await processTransaction(sb as never, U, { ...stock, operation: 'COMPRA' })
    expect(result.position).toMatchObject({ ticker: 'AAPL', quantity: 4 })
    expect(result.closedTrade).toBeNull()
  })
})

describe('newOversell', () => {
  it('tolerates an oversell the ledger already had, flags one the write adds', () => {
    const broken = [{ ...buy({ operation: 'VENTA', quantity: -3, ticker: 'ZZZ' }) }]
    expect(newOversell(broken, broken)).toBeNull()
    const sale = buy({ operation: 'VENTA', quantity: -11, date: '2026-02-01' })
    expect(newOversell([buy()], [buy(), sale])).toMatchObject({ ticker: 'AAPL', requested: 11, held: 10 })
  })

  it('deleting a buy that a later sale depends on is a new oversell', () => {
    const sale = buy({ id: 's1', operation: 'VENTA', quantity: -8, date: '2026-02-01' })
    expect(newOversell([buy(), sale], [sale])).toMatchObject({ ticker: 'AAPL', date: '2026-02-01', held: 0 })
  })
})

describe('processONTransaction', () => {
  const on = (over: Record<string, unknown> = {}) => buy({ ticker: 'MGCRD', asset_type: 'ON', quantity: 100, price: 105, ...over })

  it('rejects an ON sale of more than held and inserts nothing', async () => {
    const sb = writeSupabase({ transactions: [on()] })
    await expect(processONTransaction(sb as never, U, { date: '2026-03-01', ticker: 'MGCRD', operation: 'VENTA', quantity: 150, price: 106 }))
      .rejects.toBeInstanceOf(OversellError)
    expect(sb.rpcCalls).toEqual([])
  })

  it('a full ON sale closes the position from the core and invalidates the cache', async () => {
    const sb = writeSupabase({ transactions: [on()] })
    const result = await processONTransaction(sb as never, U, { date: '2026-03-01', ticker: 'MGCRD', operation: 'VENTA', quantity: 100, price: 106 })
    expect(result.position).toBeNull()
    expect(result.closedTrade).toMatchObject({ ticker: 'MGCRD', quantity: 100, close_price: 106, pnl: 100 })
    expect(sb.tables.transactions).toHaveLength(2)
    expect(h.invalidated).toEqual([U])
  })

  it('refuses CUPON server-side: coupons are automatic (S4, S10)', async () => {
    const sb = writeSupabase({ transactions: [on()] })
    await expect(processONTransaction(sb as never, U, { date: '2026-03-01', ticker: 'MGCRD', operation: 'CUPON' as never, quantity: 1, price: 4 }))
      .rejects.toMatchObject({ status: 400 })
    expect(sb.rpcCalls).toEqual([])
  })
})

describe('processCashMovement', () => {
  it('a DIVIDENDO from the cash form is booked as income (L3: the RPC used to reject it)', async () => {
    const sb = writeSupabase()
    const result = await processCashMovement(sb as never, U, { date: '2026-03-01', type: 'DIVIDENDO', amount: 12.5, ticker: 'KO' })
    const call = sb.rpcCalls[0].params
    expect(call).toMatchObject({ p_operation: 'DIVIDENDO', p_price: 12.5, p_ticker: 'KO', p_user_id: U })
    expect(call).not.toHaveProperty('p_quantity')
    expect(result.movement).toMatchObject({ type: 'DIVIDENDO', amount: 12.5, transaction_id: null })
    expect(result.balance).toEqual({ user_id: U, balance: 12.5 })
    expect(h.invalidated).toEqual([U])
  })

  it('refuses CUPON server-side', async () => {
    const sb = writeSupabase()
    await expect(processCashMovement(sb as never, U, { date: '2026-03-01', type: 'CUPON' as never, amount: 5 })).rejects.toMatchObject({ status: 400 })
    expect(sb.rpcCalls).toEqual([])
  })
})

describe('adjustCashBalance', () => {
  it('computes the gap from the ledger core, trades included, and lands on the target', async () => {
    const sb = writeSupabase({
      transactions: [buy()],
      cash_movements: [{ user_id: U, type: 'DEPOSITO', amount: 1500, date: '2026-01-02', transaction_id: null }, { user_id: U, type: 'COMPRA', amount: 1000, date: '2026-01-05', transaction_id: 'b1' }],
    })
    const result = await adjustCashBalance(sb as never, U, 800, '2026-01-01')
    expect(result.delta).toBe(300)
    expect(result.movement).toMatchObject({ type: 'DEPOSITO', amount: 300, transaction_id: null })
    expect(result.balance).toEqual({ user_id: U, balance: 800 })
  })
})

describe('deleteCashMovement', () => {
  it('deletes a manual movement without touching cash_balance', async () => {
    const sb = writeSupabase({ cash_movements: [{ id: 'm1', user_id: U, type: 'DEPOSITO', amount: 10, date: '2026-01-02', transaction_id: null }] })
    await deleteCashMovement(sb as never, U, 'm1')
    expect(sb.tables.cash_movements).toEqual([])
  })
})

describe('processTransactionBatch', () => {
  const rows = [
    { date: '2026-01-05', ticker: 'MSFT', operation: 'COMPRA' as const, quantity: 5, price: 300 },
    { date: '2026-02-05', ticker: 'MSFT', operation: 'VENTA' as const, quantity: 2, price: 320 },
  ]

  it('import inserts only ledger rows (transactions + linked cash movements)', async () => {
    const sb = writeSupabase({ transactions: [buy()] })
    const result = await processTransactionBatch(sb as never, U, rows)
    expect(result).toMatchObject({ success: true, imported: 2, failed: 0 })
    expect(sb.tables.transactions).toHaveLength(3)
    expect(sb.tables.cash_movements).toHaveLength(2)
  })

  it('replace keeps manual cash movements and inserts only ledger rows', async () => {
    const sb = writeSupabase({ transactions: [buy()], cash_movements: [{ user_id: U, type: 'DEPOSITO', amount: 9, date: '2026-01-01', transaction_id: null }] })
    const result = await processTransactionBatch(sb as never, U, rows, true)
    expect(result.success).toBe(true)
    expect(sb.tables.transactions.map(t => t.ticker)).toEqual(['MSFT', 'MSFT'])
    expect(sb.tables.cash_movements.map(m => m.type)).toEqual(['DEPOSITO', 'RETIRO', 'DEPOSITO'])
  })

  it('a file that sells more than held fails before anything is inserted', async () => {
    const sb = writeSupabase()
    const result = await processTransactionBatch(sb as never, U, [{ ...rows[1], quantity: 9 }, rows[0]])
    expect(result).toMatchObject({ success: false, imported: 0, errors: [{ ticker: 'MSFT', error: 'No podés vender 9 MSFT el 2026-02-05: a esa fecha tenías 5.' }] })
    expect(sb.rpcCalls).toEqual([])
  })
})
