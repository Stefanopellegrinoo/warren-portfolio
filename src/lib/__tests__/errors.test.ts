import { describe, it, expect } from 'vitest'
import { normalizeError } from '../errors'

describe('normalizeError', () => {
  it('passes through Error instances unchanged', () => {
    const original = new Error('Original error')
    const result = normalizeError(original)

    expect(result).toBe(original)
    expect(result.message).toBe('Original error')
  })

  it('extracts message from PostgrestError-like plain objects', () => {
    const postgrestError = {
      code: 'P0001',
      message: 'Insufficient position for ON sale',
      details: 'Some detail',
      hint: 'Some hint',
    }

    const result = normalizeError(postgrestError)

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('Insufficient position for ON sale')
    expect(result.cause).toBe(postgrestError)
  })

  it('extracts message from plain objects with a message property', () => {
    const obj = { message: 'Plain object error' }

    const result = normalizeError(obj)

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('Plain object error')
    expect(result.cause).toBe(obj)
  })

  it('wraps strings as Error instances', () => {
    const result = normalizeError('Something went wrong')

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('Something went wrong')
    expect(result.cause).toBe('Something went wrong')
  })

  it('wraps numbers as Error instances', () => {
    const result = normalizeError(500)

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('500')
    expect(result.cause).toBe(500)
  })

  it('wraps null as Error instance', () => {
    const result = normalizeError(null)

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('null')
    expect(result.cause).toBe(null)
  })

  it('wraps undefined as Error instance', () => {
    const result = normalizeError(undefined)

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('undefined')
    expect(result.cause).toBe(undefined)
  })
})
