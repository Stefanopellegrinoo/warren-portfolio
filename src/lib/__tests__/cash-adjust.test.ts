import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adjustCashBalance } from '../cash-engine'

vi.mock('../queue', () => ({
  addRefreshSummaryJob: vi.fn().mockResolvedValue(undefined),
  addPriceUpdateJob: vi.fn().mockResolvedValue(undefined),
  scheduleRepeatingPriceJob: vi.fn().mockResolvedValue(undefined),
  getPriceQueue: vi.fn(),
  getImportQueue: vi.fn(),
  PRICE_QUEUE_NAME: 'price-updates',
  IMPORT_QUEUE_NAME: 'import-transactions',
}))

vi.mock('../redis', () => ({
  getRedis: vi.fn(),
  isRedisReady: vi.fn().mockReturnValue(false),
  invalidateUserCache: vi.fn().mockResolvedValue(undefined),
  ensureRedisConnected: vi.fn().mockResolvedValue(false),
  SUMMARY_VERSION_TTL: 1200,
}))

vi.mock('../cache', () => ({
  invalidateCacheKey: vi.fn().mockResolvedValue(undefined),
}))

/**
 * Stateful fake: the balance rebuild must see the movement that adjustCashBalance
 * just inserted, otherwise the test would pass on a no-op implementation.
 */
function makeSupabase(movements: any[] = []) {
  const state = { movements: [...movements], balance: null as any }

  const client = {
    from(table: string) {
      if (table === 'cash_movements') {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          get data() {
            return state.movements
          },
          error: null,
          insert(row: any) {
            const inserted = { id: `cm-${state.movements.length + 1}`, ...row }
            state.movements.push(inserted)
            return {
              select: () => ({ single: async () => ({ data: inserted, error: null }) }),
            }
          },
        }
        return chain
      }

      return {
        upsert(row: any) {
          state.balance = { ...row, version: 1 }
          return {
            select: () => ({ single: async () => ({ data: state.balance, error: null }) }),
          }
        },
      }
    },
    _state: state,
  }

  return client as any
}

const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('adjustCashBalance', () => {
  it('inserts a DEPOSITO for the shortfall and lands exactly on the target', async () => {
    // Arrange — ledger says -500, the real broker balance is 1500
    const supabase = makeSupabase([{ type: 'RETIRO', amount: 500 }])

    // Act
    const result = await adjustCashBalance(supabase, USER, 1500, '2026-04-15')

    // Assert
    expect(result.delta).toBeCloseTo(2000)
    expect(result.movement).toMatchObject({
      user_id: USER,
      type: 'DEPOSITO',
      amount: 2000,
      date: '2026-04-15',
    })
    expect(Number(result.balance.balance)).toBeCloseTo(1500)
  })

  it('inserts a RETIRO when the ledger overstates the balance', async () => {
    // Arrange — ledger says 1000, reality is 250
    const supabase = makeSupabase([{ type: 'DEPOSITO', amount: 1000 }])

    // Act
    const result = await adjustCashBalance(supabase, USER, 250, '2026-04-15')

    // Assert
    expect(result.delta).toBeCloseTo(-750)
    expect(result.movement).toMatchObject({ type: 'RETIRO', amount: 750 })
    expect(Number(result.balance.balance)).toBeCloseTo(250)
  })

  it('records the adjustment with no transaction_id so it counts as an external flow', async () => {
    // Arrange — the drawdown filter keys off transaction_id IS NULL; an
    // adjustment IS external capital that was never recorded, so it must qualify
    const supabase = makeSupabase([])

    // Act
    const result = await adjustCashBalance(supabase, USER, 900, '2026-04-15')

    // Assert
    expect(result.movement).not.toBeNull()
    expect(result.movement!.transaction_id ?? null).toBeNull()
  })

  it('writes nothing when the ledger already matches the target', async () => {
    // Arrange
    const supabase = makeSupabase([{ type: 'DEPOSITO', amount: 300 }])
    const before = supabase._state.movements.length

    // Act
    const result = await adjustCashBalance(supabase, USER, 300, '2026-04-15')

    // Assert — a zero-amount movement would be noise in the ledger forever
    expect(result.movement).toBeNull()
    expect(result.delta).toBe(0)
    expect(supabase._state.movements.length).toBe(before)
  })

  it('keeps cents exact instead of leaving floating point noise', async () => {
    // Arrange — the real case: three movements that do not sum cleanly
    const supabase = makeSupabase([
      { type: 'COMPRA', amount: 25647.13 },
      { type: 'COMPRA', amount: 41182.19 },
      { type: 'COMPRA', amount: 22938.22 },
    ])

    // Act — target a clean 1000.50
    const result = await adjustCashBalance(supabase, USER, 1000.5, '2026-04-15')

    // Assert — amount must be a clean 4-decimal number, not 90768.04000000001
    const amount = result.movement!.amount
    expect(Number(amount.toFixed(4))).toBe(amount)
    expect(Number(result.balance.balance)).toBeCloseTo(1000.5, 4)
  })

  it('treats a sub-cent difference as already balanced', async () => {
    // Arrange — float replay noise must not spawn a 0.00001 movement
    const supabase = makeSupabase([{ type: 'DEPOSITO', amount: 1000.00001 }])

    // Act
    const result = await adjustCashBalance(supabase, USER, 1000, '2026-04-15')

    // Assert
    expect(result.movement).toBeNull()
  })

  it('rejects a target that is not a finite number', async () => {
    // Arrange
    const supabase = makeSupabase([])

    // Act + Assert — never let NaN reach a money column
    await expect(adjustCashBalance(supabase, USER, Number.NaN, '2026-04-15')).rejects.toThrow()
    await expect(adjustCashBalance(supabase, USER, Infinity, '2026-04-15')).rejects.toThrow()
  })

  it('rejects an empty user id', async () => {
    // Arrange
    const supabase = makeSupabase([])

    // Act + Assert
    await expect(adjustCashBalance(supabase, '', 100, '2026-04-15')).rejects.toThrow()
  })

  it('labels the movement so it is recognisable in the ledger', async () => {
    // Arrange
    const supabase = makeSupabase([])

    // Act
    const result = await adjustCashBalance(supabase, USER, 100, '2026-04-15')

    // Assert — a bare DEPOSITO would be indistinguishable from a real one
    expect(String(result.movement!.description)).toMatch(/ajuste/i)
  })

  it('honours a caller-supplied description', async () => {
    // Arrange
    const supabase = makeSupabase([])

    // Act
    const result = await adjustCashBalance(supabase, USER, 100, '2026-04-15', 'Saldo inicial Balanz')

    // Assert
    expect(result.movement!.description).toBe('Saldo inicial Balanz')
  })
})
