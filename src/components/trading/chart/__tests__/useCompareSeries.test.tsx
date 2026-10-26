import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { useCompareSeries } from '../useCompareSeries'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

type State = ReturnType<typeof useCompareSeries>
let state: State
function Probe({ symbols, ccl }: { symbols: string[]; ccl: boolean }) {
  const s = useCompareSeries(symbols, ccl)
  useEffect(() => { state = s })
  return null
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

async function render(symbols: string[], ccl: boolean, answer: () => Response) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return answer() }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<Probe symbols={symbols} ccl={ccl} />) })
  await flush()
  return { calls, unmount: () => act(() => root.unmount()) }
}

describe('useCompareSeries', () => {
  it('asks once for every compared asset, with the CCL when the chart is in pesos', async () => {
    const body = { series: { SPY: { points: [{ time: '2026-01-02', value: 400 }] } }, ccl: [{ time: '2026-01-02', value: 1000 }] }
    const { calls, unmount } = await render(['SPY', '^MERV'], true, () => Response.json(body))

    expect(calls).toEqual(['/api/compare-series?symbols=SPY%2C%5EMERV&ccl=1'])
    expect(state.status).toBe('ready')
    expect(state.series).toEqual(body.series)
    expect(state.ccl).toEqual(body.ccl)
    unmount()
  })

  it('with nothing to compare it asks for nothing', async () => {
    const { calls, unmount } = await render([], false, () => Response.json({}))

    expect(calls).toEqual([])
    expect(state.status).toBe('idle')
    unmount()
  })

  it('a failed request says so', async () => {
    const { unmount } = await render(['SPY'], false, () => Response.json({ error: 'x' }, { status: 500 }))

    expect(state.status).toBe('error')
    unmount()
  })
})
