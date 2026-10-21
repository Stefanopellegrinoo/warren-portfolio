#!/usr/bin/env tsx
/**
 * Builds src/lib/__fixtures__/byma-oracle.json from a saved BYMA Educa payload
 * (the JSON object with `.on.rows`). PUBLIC bond terms and prices only.
 *
 * Usage: npx tsx scripts/build-byma-oracle-fixture.ts <payload.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const KEEP = ['tk', 'isin', 'ley', 'me', 'est', 'fe', 'fv', 'cup', 'px', 'ai', 'ytm', 'dm', 'ren', 'amo', 'vr'] as const
const input = process.argv[2]
if (!input) throw new Error('usage: build-byma-oracle-fixture.ts <payload.json>')

const on = JSON.parse(readFileSync(input, 'utf8')).on
const rows = (on.rows as Record<string, unknown>[])
  .filter((r) => r.me === 'USD' && r.px != null && r.ytm != null && Array.isArray(r.amo) && Array.isArray(r.ren))
  .map((r) => Object.fromEntries(KEEP.map((k) => [k, r[k] ?? null])))

const out = resolve(__dirname, '../src/lib/__fixtures__/byma-oracle.json')
writeFileSync(out, JSON.stringify({ asOf: on.fecha, settle: on.fecha_liq, rows }) + '\n')
console.log(`${rows.length} rows -> ${out}`)
