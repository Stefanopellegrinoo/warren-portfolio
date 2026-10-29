import { describe, it, expect, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'
import { useCachedPerVisit } from '../use-cached-per-visit'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { forgetCached(); document.body.innerHTML = '' })

function Probe() {
  const r = useCachedPerVisit('probe:key', async () => 'answered')
  return <output>{r.loading ? 'loading' : r.data}</output>
}

describe('useCachedPerVisit', () => {
  it('answers under React strict mode, which mounts, unmounts and mounts again in development', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<StrictMode><Probe /></StrictMode>) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(el.textContent).toBe('answered')
    act(() => root.unmount())
  })
})
