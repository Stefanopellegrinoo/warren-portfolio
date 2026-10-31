import { describe, it, expect } from 'vitest'
import { lineOf, storedSymbolFor, spellingsOf, type BoardSymbols } from './list-symbols'

// Invented board: two local shares and two CEDEARs. 'ZETA' is both a local
// share and a CEDEAR line, to pin which rule wins for each spelling.
const board: BoardSymbols = {
  locals: new Set(['ALFA', 'BETA', 'ZETA']),
  cedears: new Set(['GAMA', 'DELT', 'ZETA']),
}

describe('lineOf', () => {
  it('reads BCBA:X as the local share X', () => {
    expect(lineOf('BCBA:ALFA', board)).toEqual({ kind: 'local', line: 'ALFA' })
  })

  it('reads X.BA as the same local share X', () => {
    expect(lineOf('BETA.BA', board)).toEqual({ kind: 'local', line: 'BETA' })
  })

  it('prefers the local share for BCBA:X and X.BA when X is both', () => {
    expect(lineOf('BCBA:ZETA', board)).toEqual({ kind: 'local', line: 'ZETA' })
    expect(lineOf('ZETA.BA', board)).toEqual({ kind: 'local', line: 'ZETA' })
  })

  it('reads BCBA:X and X.BA as the CEDEAR X when X is only a CEDEAR line', () => {
    expect(lineOf('BCBA:GAMA', board)).toEqual({ kind: 'cedear', line: 'GAMA' })
    expect(lineOf('DELT.BA', board)).toEqual({ kind: 'cedear', line: 'DELT' })
  })

  it('reads BCBA:X and X.BA as none when X is not on the board', () => {
    expect(lineOf('BCBA:NOPE', board)).toEqual({ kind: 'none' })
    expect(lineOf('NOPE.BA', board)).toEqual({ kind: 'none' })
  })

  it('reads a plain CEDEAR line as the CEDEAR, even when a local share has that symbol', () => {
    expect(lineOf('GAMA', board)).toEqual({ kind: 'cedear', line: 'GAMA' })
    expect(lineOf('ZETA', board)).toEqual({ kind: 'cedear', line: 'ZETA' })
  })

  it('reads a plain non-CEDEAR ticker matching a local share as its US ADR', () => {
    expect(lineOf('ALFA', board)).toEqual({ kind: 'adr', line: 'ALFA' })
  })

  it('reads anything else as none', () => {
    expect(lineOf('BTCUSDT', board)).toEqual({ kind: 'none' })
    expect(lineOf('NASDAQ:GAMA', board)).toEqual({ kind: 'none' })
    expect(lineOf('^MERV', board)).toEqual({ kind: 'none' })
    expect(lineOf('', board)).toEqual({ kind: 'none' })
    expect(lineOf('BCBA:', board)).toEqual({ kind: 'none' })
  })

  it('compares case-insensitively and ignores surrounding spaces', () => {
    expect(lineOf(' bcba:alfa ', board)).toEqual({ kind: 'local', line: 'ALFA' })
    expect(lineOf('beta.ba', board)).toEqual({ kind: 'local', line: 'BETA' })
    expect(lineOf('gama', board)).toEqual({ kind: 'cedear', line: 'GAMA' })
    expect(lineOf('Alfa', board)).toEqual({ kind: 'adr', line: 'ALFA' })
  })
})

describe('storedSymbolFor', () => {
  it('writes a local share as BCBA:X', () => {
    expect(storedSymbolFor('local', 'ALFA')).toBe('BCBA:ALFA')
  })

  it('writes a CEDEAR as plain X', () => {
    expect(storedSymbolFor('cedear', 'GAMA')).toBe('GAMA')
  })

  it('round-trips through lineOf', () => {
    expect(lineOf(storedSymbolFor('local', 'ZETA'), board)).toEqual({ kind: 'local', line: 'ZETA' })
    expect(lineOf(storedSymbolFor('cedear', 'ZETA'), board)).toEqual({ kind: 'cedear', line: 'ZETA' })
  })
})

describe('spellingsOf', () => {
  it('lists both spellings of a local share', () => {
    expect(spellingsOf('local', 'ALFA')).toEqual(['BCBA:ALFA', 'ALFA.BA'])
  })

  it('lists the one spelling of a CEDEAR', () => {
    expect(spellingsOf('cedear', 'GAMA')).toEqual(['GAMA'])
  })

  it('lists only spellings that lineOf maps back to the same line', () => {
    for (const s of spellingsOf('local', 'ZETA')) {
      expect(lineOf(s, board)).toEqual({ kind: 'local', line: 'ZETA' })
    }
  })
})
