import PortfolioList from '@/components/ons/portfolios/PortfolioList'
import { PAGE, PageHeader } from '@/components/ons/ui'

export default function CarterasPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        back={{ href: '/ons', label: 'Volver al listado' }}
        title="Carteras de prueba de ONs"
        intro="Combiná ONs con montos hipotéticos y mirá el calendario de cobros, la TIR y la concentración de la cartera."
      />
      <PortfolioList />
    </div>
  )
}
