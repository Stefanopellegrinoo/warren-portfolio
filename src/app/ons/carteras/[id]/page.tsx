import PortfolioBuilder from '@/components/ons/portfolios/PortfolioBuilder'

export default function CarteraPage({ params }: { params: { id: string } }) {
  return (
    <div className="min-h-screen">
      <div className="p-4 md:p-8">
        <PortfolioBuilder id={params.id} />
      </div>
    </div>
  )
}
