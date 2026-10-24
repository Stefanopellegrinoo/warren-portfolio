import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { cachedValue, forgetCached, load, useCached } from '../client-cache'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { forgetCached(); document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

describe('load', () => {
  it('two callers of the same key at the same time share one request, and the result is remembered', async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }))

    const [a, b] = await Promise.all([load('k', fetcher), load('k', fetcher)])

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(cachedValue('k')).toEqual({ n: 1 })
  })

  it('a failed request is not remembered and the next call asks again', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('ok')

    await expect(load('k', fetcher)).rejects.toThrow('down')
    expect(cachedValue('k')).toBeUndefined()
    await expect(load('k', fetcher)).resolves.toBe('ok')
  })
})

type Seen<T> = ReturnType<typeof useCached<T>>
let seen: Seen<string>
function Probe({ k, fetcher }: { k: string | null; fetcher: () => Promise<string> }) {
  const s = useCached(k, fetcher)
  useEffect(() => { seen = s })
  return null
}

async function render(k: string | null, fetcher: () => Promise<string>) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const show = (key: string | null, f = fetcher) => act(async () => { root.render(<Probe k={key} fetcher={f} />) })
  await show(k)
  return { show, unmount: () => act(() => root.unmount()) }
}

describe('useCached', () => {
  it('first visit: loading, then the data', async () => {
    let resolve!: (v: string) => void
    const { unmount } = await render('page', () => new Promise(r => { resolve = r }))
    expect(seen).toMatchObject({ data: undefined, loading: true })

    await act(async () => { resolve('fresh') })

    expect(seen).toMatchObject({ data: 'fresh', loading: false })
    unmount()
  })

  it('coming back shows the remembered data at once and refreshes it behind', async () => {
    await load('page', async () => 'old')
    let resolve!: (v: string) => void
    const { unmount } = await render('page', () => new Promise(r => { resolve = r }))

    expect(seen.data).toBe('old')

    await act(async () => { resolve('new') })
    expect(seen.data).toBe('new')
    unmount()
  })

  it('a failed refresh keeps the remembered data and reports the error', async () => {
    await load('page', async () => 'old')
    const { unmount } = await render('page', async () => { throw new Error('down') })
    await flush()

    expect(seen.data).toBe('old')
    expect((seen.error as Error).message).toBe('down')
    unmount()
  })

  it('a new key shows that key, never the previous one', async () => {
    await load('b', async () => 'B old')
    const { show, unmount } = await render('a', async () => 'A')
    await flush()

    await show('b', () => new Promise(() => {}))

    expect(seen.data).toBe('B old')
    unmount()
  })

  it('reload asks again and mutate shows a value at once, remembered for the next visit', async () => {
    const fetcher = vi.fn(async () => 'v1')
    const { unmount } = await render('page', fetcher)
    await flush()

    await act(async () => { seen.reload() })
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)

    act(() => seen.mutate('edited'))
    expect(seen.data).toBe('edited')
    expect(cachedValue('page')).toBe('edited')
    unmount()
  })

  it('a null key asks for nothing', async () => {
    const fetcher = vi.fn(async () => 'x')
    const { unmount } = await render(null, fetcher)
    await flush()

    expect(fetcher).not.toHaveBeenCalled()
    expect(seen).toMatchObject({ data: undefined, loading: false })
    unmount()
  })
})
