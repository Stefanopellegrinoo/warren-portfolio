import OnDetailLoader from '@/components/ons/OnDetailLoader'

export default function OnDetailPage({ params }: { params: { isin: string } }) {
  return (
    <div className="min-h-screen">
      <div className="p-4 md:p-8">
        <OnDetailLoader isin={params.isin.toUpperCase()} />
      </div>
    </div>
  )
}
