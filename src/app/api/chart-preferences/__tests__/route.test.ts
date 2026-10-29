// odd/tasks/chart-customization.md S4: favorites, remembered drawing styles and saved indicator settings
// live in the account; the route reads them, merges a change per key, and refuses anything it does not know.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GENERIC_ERROR } from '@/lib/api/errors'
import { TOO_MANY_REQUESTS } from '@/lib/rate-limit'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({ requireUser: () => mockRequireUser(), isAuthFailure: (r: object) => 'error' in r }))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}))

const { GET, PATCH } = await import('../route')

type Row = { favorites: object; tool_styles: object; indicator_settings: object }
let row: Row | null
let dbError: unknown
const reads: unknown[][] = []
const writes: Record<string, unknown>[] = []

// The SQL of patch_chart_preferences (migration 051), in JS: each section merges per key, a null removes it.
// The real statement is proved against postgres in the RLS proof; here it only lets a PATCH be read back.
function merge(stored: object, patch: object) {
  const next: Record<string, unknown> = { ...stored, ...patch }
  for (const k of Object.keys(next)) if (next[k] === null) delete next[k]
  return next
}

function signedIn() {
  const supabase = {
    from: (table: string) => {
      const filters: unknown[] = []
      const chain = {
        select: (cols: string) => { filters.push(['select', cols]); return chain },
        eq: (...args: unknown[]) => { filters.push(['eq', ...args]); return chain },
        maybeSingle: () => {
          reads.push([table, ...filters])
          return Promise.resolve(dbError ? { data: null, error: dbError } : { data: row, error: null })
        },
      }
      return chain
    },
    rpc: (fn: string, args: Record<string, object>) => {
      writes.push({ fn, ...args })
      if (dbError) return Promise.resolve({ data: null, error: dbError })
      const base = row ?? { favorites: {}, tool_styles: {}, indicator_settings: {} }
      row = {
        favorites: merge(base.favorites, args.p_favorites),
        tool_styles: merge(base.tool_styles, args.p_tool_styles),
        indicator_settings: merge(base.indicator_settings, args.p_indicator_settings),
      }
      return Promise.resolve({ data: null, error: null })
    },
  }
  mockRequireUser.mockResolvedValue({ supabase, user: { id: 'u1' } })
}

const patch = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/chart-preferences', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  })
const read = async () => (await (await GET()).json()).preferences

const INVALID = 'No se pudieron guardar los ajustes del gráfico. Recargá la página y probá de nuevo.'
const TOO_LARGE = 'Los ajustes del gráfico son demasiado grandes para guardarlos.'

beforeEach(() => {
  row = null
  dbError = null
  reads.length = 0
  writes.length = 0
  mockRateLimit.mockReset().mockResolvedValue(true)
  signedIn()
})
afterEach(() => vi.restoreAllMocks())

describe('without a session', () => {
  it('GET and PATCH answer 401 and touch nothing', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Tu sesión venció. Volvé a ingresar.' }, { status: 401 }) })
    expect((await GET()).status).toBe(401)
    expect((await PATCH(patch({ favorites: { ray: true } }))).status).toBe(401)
    expect(reads).toEqual([])
    expect(writes).toEqual([])
  })
})

describe('GET /api/chart-preferences', () => {
  it('a user who never saved anything gets empty preferences, read only from their own row', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'u1', preferences: { favorites: {}, toolStyles: {}, indicatorSettings: {} } })
    expect(reads).toEqual([['chart_preferences', ['select', 'favorites, tool_styles, indicator_settings'], ['eq', 'user_id', 'u1']]])
  })

  it('drops what a row written around the API holds that the app does not know', async () => {
    row = {
      favorites: { ray: true, 'gann-fan': true, rectangle: 'yes' },
      tool_styles: { ray: { color: '#2962ff', width: 2 }, 'trend-line': { color: 'javascript:alert(1)' }, nope: {} },
      indicator_settings: { rsi: { values: { rsi: 21 } }, macd: { values: { macdFast: 9999 } }, sma: { values: {} } },
    }
    expect(await read()).toEqual({
      favorites: { ray: true },
      toolStyles: { ray: { color: '#2962ff', width: 2 } },
      indicatorSettings: { rsi: { values: { rsi: 21 } } },
    })
  })

  it('a missing table is a 500 with the generic message, nothing about the database', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    dbError = { code: '42P01', message: 'relation "public.chart_preferences" does not exist' }
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR })
    expect(err).toHaveBeenCalled()
  })

  it('over 30 requests a minute is a 429 that reads nothing', async () => {
    mockRateLimit.mockResolvedValue(false)
    const res = await GET()
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: TOO_MANY_REQUESTS })
    expect(mockRateLimit).toHaveBeenCalledWith('rl:chart-preferences:u1', 30, 60)
    expect(reads).toEqual([])
  })
})

describe('PATCH /api/chart-preferences', () => {
  it('favorites: a star is saved and read back, a null removes it', async () => {
    expect((await PATCH(patch({ favorites: { ray: true, 'parallel-channel': true } }))).status).toBe(204)
    expect(writes).toEqual([{ fn: 'patch_chart_preferences', p_favorites: { ray: true, 'parallel-channel': true }, p_tool_styles: {}, p_indicator_settings: {} }])
    expect((await read()).favorites).toEqual({ ray: true, 'parallel-channel': true })

    expect((await PATCH(patch({ favorites: { ray: null } }))).status).toBe(204)
    expect((await read()).favorites).toEqual({ 'parallel-channel': true })
  })

  it('tool styles: the style of one tool is saved and read back, another tool keeps its own', async () => {
    const channel = { color: 'rgba(41, 98, 255, 0.8)', fillBackground: false, backgroundColor: '#089981', transparency: 70, middleLine: true }
    await PATCH(patch({ toolStyles: { 'parallel-channel': channel } }))
    await PATCH(patch({ toolStyles: { ray: { color: '#f23645', width: 3, lineStyle: 'dashed' } } }))
    expect(writes.at(-1)).toEqual({ fn: 'patch_chart_preferences', p_favorites: {}, p_tool_styles: { ray: { color: '#f23645', width: 3, lineStyle: 'dashed' } }, p_indicator_settings: {} })
    expect((await read()).toolStyles).toEqual({ 'parallel-channel': channel, ray: { color: '#f23645', width: 3, lineStyle: 'dashed' } })

    await PATCH(patch({ toolStyles: { ray: null } }))
    expect((await read()).toolStyles).toEqual({ 'parallel-channel': channel })
  })

  it('indicator settings: values and style are saved and read back, other sections untouched', async () => {
    await PATCH(patch({ favorites: { rectangle: true } }))
    const bollinger = {
      values: { bbPeriod: 21, bbStdDev: 2.5 },
      style: { lines: { upper: { color: '#2962ff', width: 2, visible: true }, middle: { visible: false } }, fills: { bands: { visible: true, color: '#2962ff', transparency: 90 } } },
    }
    const rsi = { style: { lines: { rsi: { color: '#7e57c2' } }, levels: [{ value: 70, color: '#f23645' }, { value: 30, color: '#089981', visible: true }] } }
    expect((await PATCH(patch({ indicatorSettings: { bollinger, rsi } }))).status).toBe(204)
    expect(await read()).toEqual({ favorites: { rectangle: true }, toolStyles: {}, indicatorSettings: { bollinger, rsi } })
  })

  // odd/tasks/chart-pro-redesign.md S2: which indicators are on, hidden or minimized go in each indicator's entry.
  it("an indicator's on, hidden and minimized are saved with its settings as one entry, which a later write replaces whole", async () => {
    const rsi = { values: { rsi: 21 }, style: { lines: { rsi: { color: '#f23645' } } }, on: true, hidden: true, minimized: false }
    expect((await PATCH(patch({ indicatorSettings: { rsi, obv: { on: false, hidden: false, minimized: false } } }))).status).toBe(204)
    expect((await read()).indicatorSettings).toEqual({ rsi, obv: { on: false, hidden: false, minimized: false } })

    await PATCH(patch({ indicatorSettings: { rsi: { ...rsi, hidden: false } } }))
    expect((await read()).indicatorSettings).toEqual({ rsi: { ...rsi, hidden: false }, obv: { on: false, hidden: false, minimized: false } })
  })

  it('every factory style the drawing library gives a tool can be remembered', async () => {
    const { factoryStyleFor } = await import('lightweight-charts-drawing')
    const res = await PATCH(patch({ toolStyles: { 'fib-retracement': factoryStyleFor('fib-retracement'), 'long-position': factoryStyleFor('long-position') } }))
    expect(res.status).toBe(204)
  })

  it.each([
    ['an unknown tool kind', { favorites: { 'gann-fan': true } }],
    ['an unknown tool kind in styles', { toolStyles: { 'gann-fan': { color: '#fff' } } }],
    ['an unknown indicator key', { indicatorSettings: { sma: { values: {} } } }],
    ['an unknown section', { watchlist: { SPY: true } }],
    ['a favorite that is not true or null', { favorites: { ray: 'yes' } }],
    ['a bad color', { toolStyles: { ray: { color: 'red; background:url(x)' } } }],
    ['a bad color in an unlisted color field', { toolStyles: { 'long-position': { stopColor: 'url(javascript:1)' } } }],
    ['a bad color in a fib level', { toolStyles: { 'fib-retracement': { levels: [{ coeff: 0.5, color: 'nope', visible: true }] } } }],
    ['a bad indicator line color', { indicatorSettings: { ema20: { style: { lines: { ema: { color: 'blue' } } } } } }],
    ['a width out of range', { toolStyles: { ray: { width: 500 } } }],
    ['a period out of range', { indicatorSettings: { ema20: { values: { ema20: 1 } } } }],
    ['a value field of another indicator', { indicatorSettings: { ema20: { values: { macdFast: 12 } } } }],
    ['an indicator turned on with a value that is not a boolean', { indicatorSettings: { rsi: { on: 'yes' } } }],
    ['an unknown field next to on, hidden and minimized', { indicatorSettings: { rsi: { on: true, enabled: true } } }],
    ['a field name that is not an identifier', { toolStyles: { ray: { __proto__x: 1, 'a b': 2 } } }],
    ['a string too long', { toolStyles: { text: { text: 'x'.repeat(301) } } }],
    ['nesting too deep', { toolStyles: { ray: { a: { b: { c: { d: 1 } } } } } }],
    ['one entry over 4 KB', { toolStyles: { brush: { note1: 'x'.repeat(300), ...Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`k${i}`, 'y'.repeat(299)])) } } }],
    ['a section that is not an object', { favorites: ['ray'] }],
    ['nothing to save', {}],
  ])('refuses %s with a Spanish 400 and writes nothing', async (_, body) => {
    const res = await PATCH(patch(body))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: INVALID })
    expect(writes).toEqual([])
  })

  it('refuses a body over 128 KB, by its header or by its size, and writes nothing', async () => {
    const big = JSON.stringify({ favorites: { ray: true }, pad: 'x'.repeat(130 * 1024) })
    const byHeader = await PATCH(patch({ favorites: { ray: true } }, { 'content-length': String(200 * 1024) }))
    const bySize = await PATCH(patch(big))
    for (const res of [byHeader, bySize]) {
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: TOO_LARGE })
    }
    expect(writes).toEqual([])
  })

  it('refuses a "__proto__" field, which zod would turn into an unchecked prototype', async () => {
    const res = await PATCH(patch('{"toolStyles": {"ray": {"color": "#fff", "__proto__": {"color": "javascript:1"}}}}'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: INVALID })
    expect(writes).toEqual([])
  })

  it('a body that is not JSON is a 400', async () => {
    const res = await PATCH(patch('{"favorites": '))
    expect(res.status).toBe(400)
    expect(writes).toEqual([])
  })

  it('a missing function or table is a 500 with the generic message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    dbError = { code: 'PGRST202', message: 'Could not find the function public.patch_chart_preferences' }
    const res = await PATCH(patch({ favorites: { ray: true } }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR })
  })

  it('over 30 requests a minute is a 429 that writes nothing', async () => {
    mockRateLimit.mockResolvedValue(false)
    const res = await PATCH(patch({ favorites: { ray: true } }))
    expect(res.status).toBe(429)
    expect(mockRateLimit).toHaveBeenCalledWith('rl:chart-preferences:u1', 30, 60)
    expect(writes).toEqual([])
  })
})
