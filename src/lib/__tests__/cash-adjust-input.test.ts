import { describe, it, expect } from 'vitest'
import { buildAdjustPayload } from '../cash-adjust-input'

const DATE = '2026-04-15'

describe('buildAdjustPayload', () => {
  it('accepts a plain positive balance', () => {
    const result = buildAdjustPayload('1500.25', DATE)
    expect(result).toEqual({ ok: true, payload: { balance: 1500.25, date: DATE, description: undefined } })
  })

  it('accepts a negative balance', () => {
    // The whole point of the feature: an imported ledger sits below zero
    const result = buildAdjustPayload('-239803.19', DATE)
    expect(result.ok && result.payload.balance).toBe(-239803.19)
  })

  it('accepts an explicit zero', () => {
    // Reconciling to zero is legitimate — do not confuse it with an empty field
    const result = buildAdjustPayload('0', DATE)
    expect(result.ok && result.payload.balance).toBe(0)
  })

  it('rejects an empty field instead of reconciling the account to zero', () => {
    // Number('') is 0 and passes isFinite — the trap this function exists for
    const result = buildAdjustPayload('', DATE)
    expect(result).toEqual({ ok: false, error: 'Ingresá un saldo válido' })
  })

  it('rejects a whitespace-only field', () => {
    const result = buildAdjustPayload('   ', DATE)
    expect(result.ok).toBe(false)
  })

  it('rejects text that is not a number', () => {
    expect(buildAdjustPayload('abc', DATE).ok).toBe(false)
    expect(buildAdjustPayload('1.234,56', DATE).ok).toBe(false)
  })

  it('rejects a missing or malformed date', () => {
    expect(buildAdjustPayload('100', '').ok).toBe(false)
    expect(buildAdjustPayload('100', '15/04/2026').ok).toBe(false)
  })

  it('drops a blank description rather than sending an empty string', () => {
    const result = buildAdjustPayload('100', DATE, '   ')
    expect(result.ok && result.payload.description).toBeUndefined()
  })

  it('trims a supplied description', () => {
    const result = buildAdjustPayload('100', DATE, '  Saldo inicial  ')
    expect(result.ok && result.payload.description).toBe('Saldo inicial')
  })
})
