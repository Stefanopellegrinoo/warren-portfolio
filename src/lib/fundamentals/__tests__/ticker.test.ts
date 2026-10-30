import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTicker } from '../ticker'
import * as service from '../service'

// odd/tasks/asset-page.md L29: one parseTicker for the server and the client.
describe('parseTicker', () => {
  it('normalizes the forms the app writes and rejects the rest', () => {
    expect(parseTicker(' meli ')).toBe('MELI')
    expect(parseTicker('bcba:ggal')).toBe('BCBA:GGAL')
    expect(parseTicker('GGAL.BA')).toBe('BCBA:GGAL')
    expect(parseTicker('BRK.B')).toBe('BRK.B')
    for (const bad of ['', 'MELI; DROP', 'A'.repeat(16), 'NASDAQ:MELI', '-MELI', 'b@d']) expect(parseTicker(bad)).toBeNull()
  })

  it('is client-safe: its module imports nothing, and the service serves the same function', () => {
    const source = readFileSync(join(__dirname, '..', 'ticker.ts'), 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(service.parseTicker).toBe(parseTicker)
  })
})
