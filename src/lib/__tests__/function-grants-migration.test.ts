// T4 (odd/tasks/security-hardening.md S4): anon cannot execute any write function,
// and the worker-only functions are executable by the service role alone.
// Read as text: there is no database in the tests.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raw = readFileSync(join(process.cwd(), 'supabase/migrations/048_function_grants.sql'), 'utf8')
const sql = raw.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim()

const SETUP = 'public.update_setup_performance_atomic(uuid, uuid, uuid, text, numeric, numeric)'
const IMPORT = 'public.import_transactions_atomic(uuid, jsonb)'
const REPLACE = 'public.replace_portfolio_atomic(uuid, jsonb)'
const PROCESS = 'public.process_transaction_atomic(date, text, text, numeric, numeric, numeric, text, text, text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, date, text)'
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('048_function_grants.sql', () => {
  it('runs in one transaction', () => {
    expect(sql).toMatch(/^BEGIN;/i)
    expect(sql).toMatch(/COMMIT;$/i)
  })

  it('makes update_setup_performance_atomic SECURITY INVOKER with a fixed search_path', () => {
    expect(sql).toMatch(new RegExp(`ALTER FUNCTION ${esc(SETUP)} SECURITY INVOKER SET search_path = public, pg_temp;`, 'i'))
  })

  it.each([SETUP, IMPORT, REPLACE])('%s: revoked from PUBLIC, anon and authenticated, granted to service_role only', (fn) => {
    expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${esc(fn)} FROM PUBLIC, anon, authenticated;`, 'i'))
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${esc(fn)} TO service_role;`, 'i'))
  })

  it('process_transaction_atomic: revoked from PUBLIC and anon, still granted to authenticated and service_role', () => {
    expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${esc(PROCESS)} FROM PUBLIC, anon;`, 'i'))
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${esc(PROCESS)} TO authenticated, service_role;`, 'i'))
  })

  it('changes nothing but grants and that one function header', () => {
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean).slice(1, -1)
    expect(statements).toHaveLength(9)
    for (const s of statements) expect(s).toMatch(/^(REVOKE EXECUTE ON FUNCTION|GRANT EXECUTE ON FUNCTION|ALTER FUNCTION)/i)
  })
})
