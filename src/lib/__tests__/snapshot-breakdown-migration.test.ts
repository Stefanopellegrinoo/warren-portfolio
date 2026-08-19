import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/034_snapshot_breakdown.sql'),
  'utf8'
)

describe('migration 034 — snapshot breakdown', () => {
  it('adds all five breakdown columns', () => {
    for (const col of ['stocks_value', 'stocks_invested', 'ons_value', 'ons_invested', 'cash_value']) {
      expect(migration).toMatch(new RegExp(`add column if not exists ${col}`, 'i'))
    }
  })

  it('leaves every column NULLABLE — null means "not known", zero would be a false claim', () => {
    // A `not null default 0` here would assert that pre-migration rows held
    // nothing in each class, which is false and would poison later averages.
    expect(migration).not.toMatch(/not\s+null/i)
    expect(migration).not.toMatch(/default\s+0/i)
  })

  it('is re-runnable', () => {
    const adds = migration.match(/add column/gi) ?? []
    const guarded = migration.match(/add column if not exists/gi) ?? []
    expect(guarded.length).toBe(adds.length)
  })
})
