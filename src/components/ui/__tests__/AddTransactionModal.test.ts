import { describe, it, expect, vi } from 'vitest'
import {
  nextPendingConfirmation,
  resetFormNavigationState,
  confirmedSubmitPayload,
} from '../AddTransactionModal'
import type { ResolveResult } from '../../../lib/ticker-identity'

describe('nextPendingConfirmation', () => {
  const resolution: ResolveResult = {
    found: true,
    identity: { ticker: 'UN', yahooSymbol: 'UN', name: 'Corgi UNH 2x Daily ETF', exchange: 'Cboe US', price: 25.0261 },
  }

  it('returns the confirmation payload when the result needs confirmation', () => {
    const payload = { ticker: 'UN', assetType: 'ACCION' }

    expect(nextPendingConfirmation({ ok: false, kind: 'needs-confirmation', resolution }, payload)).toEqual({
      resolution,
      payload,
    })
  })

  it('clears to null on outright success, dropping any stale confirmation from a prior attempt', () => {
    expect(nextPendingConfirmation({ ok: true }, { ticker: 'NVDA' })).toBeNull()
  })

  it('clears to null on a plain error, dropping any stale confirmation from a prior attempt', () => {
    expect(nextPendingConfirmation({ ok: false, kind: 'error', message: 'boom' }, { ticker: 'NVDA' })).toBeNull()
  })
})

describe('confirmedSubmitPayload', () => {
  const resolution: ResolveResult = {
    found: true,
    identity: { ticker: 'UN', yahooSymbol: 'UN', name: 'Corgi UNH 2x Daily ETF', exchange: 'Cboe US', price: 25.0261 },
  }
  const pending = { resolution, payload: { ticker: 'UN', quantity: 1769, price: 14.2983, assetType: 'CEDEAR' } }

  it('refuses when the user corrected the ticker after seeing the panel — the UN → UNH case', () => {
    // The panel says "UN es Corgi UNH 2x Daily ETF". The user fixes the field
    // to UNH and presses "Sí, agregar". Confirming UN here writes the wrong
    // instrument AND catalogues it as human-confirmed.
    const live = { ...pending.payload, ticker: 'UNH' }

    expect(confirmedSubmitPayload(pending, live)).toEqual({ ok: false, reason: 'ticker-changed' })
  })

  it('refuses when the ticker field was cleared', () => {
    expect(confirmedSubmitPayload(pending, { ...pending.payload, ticker: '' })).toEqual({
      ok: false,
      reason: 'ticker-changed',
    })
  })

  it('submits the LIVE payload, not the snapshot captured when the 409 arrived', () => {
    // Same ticker, edited quantity: the confirmation still applies, and the
    // number the user is looking at is the one that must reach the server.
    const live = { ...pending.payload, quantity: 42 }

    expect(confirmedSubmitPayload(pending, live)).toEqual({ ok: true, payload: live })
  })

  it('treats casing and surrounding whitespace as the same ticker', () => {
    const live = { ...pending.payload, ticker: '  un  ' }

    expect(confirmedSubmitPayload(pending, live)).toMatchObject({ ok: true })
  })
})

describe('resetFormNavigationState', () => {
  it('clears both the validation error and any pending ticker confirmation together', () => {
    const setError = vi.fn()
    const setPendingConfirmation = vi.fn()

    resetFormNavigationState(setError, setPendingConfirmation)

    expect(setError).toHaveBeenCalledWith('')
    expect(setPendingConfirmation).toHaveBeenCalledWith(null)
  })
})
