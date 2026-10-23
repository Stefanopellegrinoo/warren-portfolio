import { describe, it, expect, vi, afterEach } from 'vitest'
import { serverError, GENERIC_ERROR } from '../errors'
import { normalizeError } from '@/lib/errors'

afterEach(() => vi.restoreAllMocks())

describe('serverError', () => {
  it('answers 500 with the generic message, never the internal text, and logs the cause with its tag', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cause = { code: '42P01', message: 'relation "secret_table" does not exist' }

    const res = serverError('Statistics', cause)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: GENERIC_ERROR })
    expect(JSON.stringify(body)).not.toContain('secret_table')
    expect(log).toHaveBeenCalledWith('[Statistics]', cause)
  })

  it('keeps a deliberate RAISE EXCEPTION (P0001), raw or normalized, with its 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = { code: 'P0001', message: 'Transaction failed: Insufficient position: cannot sell 5 UN (SQLSTATE: P0001)' }

    for (const err of [raw, normalizeError(raw)]) {
      const res = serverError('Transactions', err)
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: raw.message })
    }
  })

  it('hides an internal failure that process_transaction_atomic re-raised as P0001', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapped = { code: 'P0001', message: 'Transaction failed: duplicate key value violates unique constraint "tx_pkey" (SQLSTATE: 23505)' }

    expect(await serverError('Transactions', wrapped).json()).toEqual({ error: GENERIC_ERROR })
  })

  it('keeps the guards the engines throw on purpose', async () => {
    const lock = 'Hay una importación masiva en curso para este usuario. Por favor, espere a que finalice para realizar cambios manuales.'
    const onTicker = "ON tickers must end with 'D' for Dollar-MEP bonds. 'YCA6O' is invalid."

    for (const message of [lock, onTicker]) {
      expect(await serverError('X', new Error(message)).json()).toEqual({ error: message })
    }
  })
})
