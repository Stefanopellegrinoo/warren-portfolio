import { describe, it, expect, vi } from 'vitest'
import {
  nextPendingConfirmation,
  resetFormNavigationState,
  confirmedSubmitPayload,
  completeSubmit,
  summarizeStaleSnapshots,
} from '../AddTransactionModal'
import type { ResolveResult } from '../../../lib/ticker-identity'
import type { RetroactiveWarning } from '../../../lib/api/retroactive-warning'

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

describe('completeSubmit', () => {
  const warning: RetroactiveWarning = {
    code: 'RETROACTIVE_ENTRY',
    entryDate: '2026-07-02',
    staleSnapshots: ['2026-07-23'],
  }

  it('calls onSuccess exactly once, and BEFORE either branch — the row was already written', () => {
    // Ordering is the defect-prone part: onSuccess must run even though the
    // modal holds open, and it must run first because the write already
    // happened by the time this runs.
    const calls: string[] = []
    const onSuccess = vi.fn(() => calls.push('onSuccess'))
    const setRetroWarning = vi.fn(() => calls.push('setRetroWarning'))
    const onClose = vi.fn(() => calls.push('onClose'))

    completeSubmit([warning], onSuccess, setRetroWarning, onClose)

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['onSuccess', 'setRetroWarning'])
  })

  it('does NOT close when a warning is present — the panel holds the modal open', () => {
    const setRetroWarning = vi.fn()
    const onClose = vi.fn()

    completeSubmit([warning], vi.fn(), setRetroWarning, onClose)

    expect(setRetroWarning).toHaveBeenCalledWith(warning)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when there is no warning', () => {
    const setRetroWarning = vi.fn()
    const onClose = vi.fn()

    completeSubmit(undefined, vi.fn(), setRetroWarning, onClose)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(setRetroWarning).not.toHaveBeenCalled()
  })

  it('closes instead of rendering a malformed warning whose staleSnapshots is not an array', () => {
    // `warnings` arrives from res.json() typed `any` — a drifted server shape
    // (staleSnapshots renamed, dropped, or serialized as something else)
    // must not reach the panel's .map(), which would throw with no error
    // boundary to catch it.
    const setRetroWarning = vi.fn()
    const onClose = vi.fn()
    const malformed = { code: 'RETROACTIVE_ENTRY', entryDate: '2026-07-02' } as unknown as RetroactiveWarning

    completeSubmit([malformed], vi.fn(), setRetroWarning, onClose)

    expect(setRetroWarning).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('summarizeStaleSnapshots', () => {
  it('names the single date directly when there is exactly one', () => {
    expect(summarizeStaleSnapshots(['2026-07-23'])).toBe('1 día medido: 2026-07-23')
  })

  it('leads with a count and range instead of enumerating every date', () => {
    // Regression for the unbounded <li>-per-date list: the ONs measured-only
    // backlog is 28 rows today and growing ~21/month, so an entry backdated a
    // few months would otherwise render 40+ items inline.
    expect(summarizeStaleSnapshots(['2026-05-02', '2026-06-15', '2026-08-01'])).toBe(
      '3 días medidos, del 2026-05-02 al 2026-08-01'
    )
  })

  it('returns an empty string for an empty list rather than a nonsensical range', () => {
    expect(summarizeStaleSnapshots([])).toBe('')
  })
})
