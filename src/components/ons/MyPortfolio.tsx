'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './portfolios/api'
import MyPortfolioView, { type MyPortfolioData } from './MyPortfolioView'

export default function MyPortfolio() {
  const [data, setData] = useState<MyPortfolioData | null>(null)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const load = useCallback(async () => {
    const r = await api<MyPortfolioData>('/api/ons/mi-cartera')
    if (!mounted.current) return // unmounted while the request was in flight
    if (!r.ok) return setFailed(true)
    setFailed(false)
    setData(r.data)
  }, [])
  useEffect(() => { void load() }, [load])

  if (failed) {
    return (
      <div className="glass flex flex-col items-start gap-3 rounded-2xl p-6" role="alert">
        <p className="text-sm text-rose">No se pudo calcular tu cartera de ONs.</p>
        <button type="button" className="btn-ghost" onClick={() => void load()}>Reintentar</button>
      </div>
    )
  }
  if (!data) return <div className="glass flex items-center justify-center rounded-2xl p-10"><div role="status" aria-label="Cargando tu cartera" className="h-6 w-6 animate-spin rounded-full border-2 border-amber/30 border-t-amber" /></div>
  return <MyPortfolioView data={data} />
}
