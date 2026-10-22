import MyPortfolio from '@/components/ons/MyPortfolio'
import { PAGE, PageHeader } from '@/components/ons/ui'

export default function MiCarteraPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        back={{ href: '/ons', label: 'Volver al listado' }}
        title="Mi cartera de ONs"
        intro="Los cobros futuros de las ONs que tenés hoy: calendario mensual, ingreso anual, vencimientos y TIR al precio actual. Solo lectura."
      />
      <MyPortfolio />
    </div>
  )
}
