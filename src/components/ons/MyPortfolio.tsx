'use client'

import { useCached } from '@/lib/client-cache'
import { apiData } from './portfolios/api'
import MyPortfolioView, { MyPortfolioFooter, type MyPortfolioData } from './MyPortfolioView'
import OnPayments, { useOnPayments } from './OnPayments'
import { Loading, LoadError } from './ui'

export default function MyPortfolio() {
  // Seen before in this tab, it shows at once and refreshes behind (odd/tasks/rendimiento.md S9).
  const { data, error, reload } = useCached('ons:my-portfolio', () => apiData<MyPortfolioData>('/api/ons/mi-cartera'))
  const payments = useOnPayments()

  if (!data && error) return <LoadError message="No se pudo calcular tu cartera de ONs." onRetry={reload} />
  if (!data) return <Loading label="Cargando tu cartera" />
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
      <MyPortfolioView data={data} missing={payments.data?.missing} />
      <OnPayments state={payments} />
      <MyPortfolioFooter />
    </div>
  )
}
