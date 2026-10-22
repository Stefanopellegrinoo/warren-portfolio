import Link from 'next/link'
import type { ReviewItem } from '@/lib/resumen/holdings'
import { Chip, SectionHead } from './ui'

export default function ReviewList({ items }: { items: ReviewItem[] }) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="h-revisar">
      <SectionHead id="h-revisar" title="Para revisar" count={items.length} />
      <ul>
        {items.map(i => (
          <li key={i.ticker} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-line py-3 last:border-b-0">
            <Link href={`/trading?symbol=${encodeURIComponent(i.ticker)}`} className="font-medium text-ink hover:text-accent-ink">
              {i.name ? `${i.ticker}, ${i.name}` : i.ticker}
            </Link>
            <Chip tone={i.tone} className="row-span-2 self-center">{i.chip}</Chip>
            <span className="text-[13px] text-ink-3">{i.why}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
