#!/usr/bin/env tsx
/**
 * Builds src/lib/__fixtures__/byma-oracle.json from a saved BYMA Educa payload.
 * PUBLIC bond terms and prices only (no account data).
 *
 * Source: BYMA Educa "Informe Diario de Renta Fija" (https://www.bymaeduca.com.ar/;
 * exact page URL not recorded). The page embeds its data as
 *   <script id="payload" type="application/json">{ "on": { fecha, fecha_liq, rows[] }, ... }</script>
 * Save that JSON (or the whole object) to a file and pass it here. Only `.on` is used.
 *
 * Usage: npx tsx scripts/build-byma-oracle-fixture.ts <payload.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const KEEP = ['tk', 'isin', 'ley', 'me', 'est', 'fc', 'fe', 'fv', 'cup', 'px', 'ai', 'ytm', 'dm', 'ren', 'amo', 'vr'] as const
const input = process.argv[2]
if (!input) throw new Error('usage: build-byma-oracle-fixture.ts <payload.json>')

const on = JSON.parse(readFileSync(input, 'utf8')).on
const all = on.rows as Record<string, unknown>[]
const excluded: Record<string, number> = {}
const rows = all
  .filter((r) => {
    const reason =
      r.me !== 'USD' ? 'not USD'
      : r.px == null ? 'no px'
      : r.ytm == null ? 'no ytm'
      : !Array.isArray(r.amo) || !Array.isArray(r.ren) ? 'no flows'
      : null
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1
    return reason === null
  })
  .map((r) => Object.fromEntries(KEEP.map((k) => [k, r[k] ?? null])))
  .sort((a, b) => String(a.tk).localeCompare(String(b.tk)))

const out = resolve(__dirname, '../src/lib/__fixtures__/byma-oracle.json')
writeFileSync(out, JSON.stringify({ asOf: on.fecha, settle: on.fecha_liq, rows }, null, 2) + '\n')
console.log(`${rows.length} of ${all.length} rows -> ${out}`)
console.log('excluded by reason:', excluded)
