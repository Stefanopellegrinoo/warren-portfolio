import { Suspense } from 'react'
import MarketPage from '@/components/market/MarketPage'
import { PAGE, PageHeader } from '@/components/ons/ui'

export default function MercadoPage() {
  return (
    <div className={PAGE}>
      <PageHeader title="Mercado" intro="Cómo vienen hoy el Panel líder, los CEDEARs y tus listas." />
      <Suspense fallback={null}>
        <MarketPage />
      </Suspense>
    </div>
  )
}
