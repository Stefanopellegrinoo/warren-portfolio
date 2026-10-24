'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './portfolios/api'
import MyPortfolioView, { MyPortfolioFooter, type MyPortfolioData } from './MyPortfolioView'
import OnPayments, { useOnPayments } from './OnPayments'
import { Loading, LoadError } from './ui'

export default function MyPortfolio() {
  const [data, setData] = useState<MyPortfolioData | null>(null)
  const [failed, setFailed] = useState(false)
  const payments = useOnPayments()
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

  if (failed) return <LoadError message="No se pudo calcular tu cartera de ONs." onRetry={() => void load()} />
  if (!data) return <Loading label="Cargando tu cartera" />
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
      <MyPortfolioView data={data} missing={payments.data?.missing} />
      <OnPayments state={payments} />
      <MyPortfolioFooter />
    </div>
  )
}
