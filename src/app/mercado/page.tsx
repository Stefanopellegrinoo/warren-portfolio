import { Suspense } from 'react'
import MarketPage from '@/components/market/MarketPage'
import { WIDE_PAGE } from '@/components/ons/ui'

// S8: the Resumen's wide column; the page draws its own header (title, market state, currency).
export default function MercadoPage() {
  return (
    <div className={WIDE_PAGE}>
      <Suspense fallback={null}>
        <MarketPage />
      </Suspense>
    </div>
  )
}
