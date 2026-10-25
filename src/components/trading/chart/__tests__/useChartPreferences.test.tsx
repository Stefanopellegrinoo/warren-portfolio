// odd/tasks/chart-customization.md S4: components read the account's chart preferences through one hook,
// and a change shows on the next render, before the account answers.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { useChartPreferences } from '../useChartPreferences'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('useChartPreferences', () => {
  it("renders the account's favorites and a new star at once", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ userId: 'u1', preferences: { favorites: { ray: true }, toolStyles: {}, indicatorSettings: {} } })))
    vi.stubGlobal('fetch', fetchMock)
    let api: ReturnType<typeof useChartPreferences> | null = null
    function Probe() {
      api = useChartPreferences()
      return <p>{Object.keys(api.preferences.favorites).join(',')}</p>
    }
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<Probe />) })
    expect(el.textContent).toBe('ray')

    act(() => { api!.setFavorite('rectangle', true) })
    expect(el.textContent).toBe('ray,rectangle')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
    act(() => root.unmount())
  })
})
