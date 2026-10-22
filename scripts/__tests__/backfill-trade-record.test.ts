import { describe, it, expect, vi } from 'vitest'
import { parseArgs, run, RECORD_COLUMNS, type Deps } from '../backfill-trade-record'

const USER = '54745d6e-3c1f-49b3-b46d-78d4016e8c20'
const nulls = Object.fromEntries(RECORD_COLUMNS.map(c => [c, c === 'needs_review' ? false : null]))
const TABLES: Record<string, unknown[]> = {
  transactions: [
    { id: 'a1', date: '2026-03-02', ticker: 'AAPL', operation: 'COMPRA', asset_type: 'ACCION', moneda: 'USD', quantity: '1.5', price: '200', commission: '0', created_at: '2026-03-16T14:00:00+00:00', ...nulls },
    { id: 'a2', date: '2026-03-02', ticker: 'DIS', operation: 'COMPRA', asset_type: 'ACCION', moneda: 'USD', quantity: '2', price: '90', commission: '0', created_at: '2026-03-16T14:00:00+00:00', ...nulls },
    { id: 'c1', date: '2026-03-16', ticker: 'AAPL', operation: 'COMPRA', asset_type: 'CEDEAR', moneda: 'ARS', quantity: '2', price: '200', commission: '0', created_at: '2026-03-16T14:00:00+00:00', ...nulls },
  ],
  fx_rates: [
    { date: '2026-03-02', kind: 'mep', buy: 1400, sell: 1400 }, { date: '2026-03-02', kind: 'ccl', buy: 1500, sell: 1500 },
    { date: '2026-03-16', kind: 'mep', buy: 1450, sell: 1450 }, { date: '2026-03-16', kind: 'ccl', buy: 1600, sell: 1600 },
  ],
  cedears: [{ ticker: 'AAPL', ratio: 20 }],
}

function mockClient() {
  const filters: [string, string, unknown][] = []
  const client = {
    rpc: vi.fn(async (_fn: string, args: { p_rows: unknown[] }) => ({ data: args.p_rows.length, error: null })),
    from(table: string) {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.order = () => chain
      chain.eq = (c: string, v: unknown) => { filters.push([table, c, v]); return chain }
      chain.is = (c: string, v: unknown) => { filters.push([table, c, v]); return chain }
      chain.range = async (from: number) => ({ data: from === 0 ? TABLES[table] : [], error: null })
      chain.update = chain.insert = chain.upsert = chain.delete = () => { throw new Error(`direct write on ${table}`) }
      return chain
    },
  }
  return { client, filters }
}

function deps(client: unknown) {
  const lines: string[] = []
  const files: Record<string, string> = {}
  const d: Deps = {
    client: client as Deps['client'], log: l => lines.push(l),
    writeFile: (p, s) => { files[p] = s }, readFile: p => files[p], stamp: () => 'STAMP',
  }
  return { d, lines, files }
}

describe('parseArgs', () => {
  it('requires a user uuid and keeps --apply and --restore exclusive', () => {
    expect(parseArgs([])).toHaveProperty('error')
    expect(parseArgs(['--user', 'nope'])).toHaveProperty('error')
    expect(parseArgs(['--user', USER])).toEqual({ user: USER, apply: false, restore: null })
    expect(parseArgs(['--user', USER, '--apply'])).toEqual({ user: USER, apply: true, restore: null })
    expect(parseArgs(['--user', USER, '--apply', '--restore', 'x.json'])).toHaveProperty('error')
  })
})

describe('backfill-trade-record', () => {
  it('dry run: reads only the user rows without a record, prints the plan, writes nothing', async () => {
    const { client, filters } = mockClient()
    const { d, lines, files } = deps(client)
    expect(await run({ user: USER, apply: false, restore: null }, d)).toBe(0)
    expect(filters).toContainEqual(['transactions', 'user_id', USER])
    expect(filters).toContainEqual(['transactions', 'trade_currency', null])
    expect(client.rpc).not.toHaveBeenCalled()
    expect(files).toEqual({})
    const out = lines.join('\n')
    expect(out).toContain('3 rows without a trade record; 3 planned, 0 skipped')
    expect(out).toContain('by asset_type:     ACCION=2 CEDEAR=1')
    expect(out).toContain('needs_review:      1')
    expect(out).toContain('id,date,ticker,')
    expect(out).toMatch(/^c1,2026-03-16,AAPL,COMPRA,CEDEAR,ARS,2,200,0,.*,ARS,40,16000,0,20,1450,1600,2026-03-16,reference,false,$/m)
    expect(out).toContain('DRY RUN')
  })

  it('--apply: backs up the 044 columns first, then writes every planned row in one RPC call', async () => {
    const { client } = mockClient()
    const { d, lines, files } = deps(client)
    await run({ user: USER, apply: true, restore: null }, d)
    const backup = JSON.parse(files['./trade-record-backup-STAMP.json'])
    expect(backup.user).toBe(USER)
    expect(backup.rows).toEqual(['a1', 'a2', 'c1'].map(id => ({ id, ...nulls })))
    expect(client.rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = client.rpc.mock.calls[0]
    expect(fn).toBe('apply_trade_record_backfill')
    expect(args.p_user_id).toBe(USER)
    expect(args.p_rows.map((r: { id: string }) => r.id)).toEqual(['a1', 'a2', 'c1'])
    for (const r of args.p_rows) expect(Object.keys(r).sort()).toEqual(['id', ...RECORD_COLUMNS].sort())
    expect(lines.join('\n')).toContain('Backup written: ./trade-record-backup-STAMP.json')
    expect(lines.join('\n')).toContain(`--restore ./trade-record-backup-STAMP.json`)
  })

  it('--restore writes the backup back through the same function', async () => {
    const { client } = mockClient()
    const { d, files } = deps(client)
    files['b.json'] = JSON.stringify({ user: USER, rows: [{ id: 'a1', ...nulls }] })
    await run({ user: USER, apply: false, restore: 'b.json' }, d)
    expect(client.rpc).toHaveBeenCalledWith('apply_trade_record_backfill', { p_user_id: USER, p_rows: [{ id: 'a1', ...nulls }] })
  })

  it('--restore refuses a backup of another user', async () => {
    const { client } = mockClient()
    const { d, files } = deps(client)
    files['b.json'] = JSON.stringify({ user: 'someone-else', rows: [] })
    await expect(run({ user: USER, apply: false, restore: 'b.json' }, d)).rejects.toThrow('backup belongs to someone-else')
    expect(client.rpc).not.toHaveBeenCalled()
  })
})
