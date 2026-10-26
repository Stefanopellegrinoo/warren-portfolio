import { describe, it, expect, vi, afterEach } from 'vitest'
import { toast } from 'sonner'

vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() },
  })
})
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { addSymbolToCurrentWatchlist } = await import('../watchlist')
const { useChartStore } = await import('@/lib/store/chart-store')

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('addSymbolToCurrentWatchlist with Cartera chosen', () => {
  it('adds nowhere and says the list builds itself, without a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    useChartStore.setState({ activeWatchlistId: '__cartera__', watchlist: ['SPY'] })

    const result = await addSymbolToCurrentWatchlist('AAPL')

    expect(result.success).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(useChartStore.getState().watchlist).toEqual(['SPY'])
    expect(toast.error).toHaveBeenCalledWith('Cartera se arma sola con tus acciones: elegí otra lista para agregar')
  })
})
