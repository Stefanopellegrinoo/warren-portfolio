import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/033_snapshot_source.sql'),
  'utf8'
)

describe('migration 033 — snapshot source', () => {
  it('defaults existing rows to live, never to estimated', () => {
    // Existing rows are real observations. Defaulting them to 'estimated'
    // would relabel measured history as reconstructed.
    expect(migration).toMatch(/default\s+'live'/i)
    expect(migration).not.toMatch(/default\s+'estimated'/i)
  })

  it('constrains the column to the two known values', () => {
    expect(migration).toMatch(/check\s*\(source in \('live', 'estimated'\)\)/i)
  })

  it('is re-runnable', () => {
    expect(migration).toMatch(/add column if not exists/i)
    expect(migration).toMatch(/drop constraint if exists/i)
  })
})
