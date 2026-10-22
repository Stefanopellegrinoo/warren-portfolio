'use client'

import { provenanceLabel } from '@/lib/series-provenance'
import type { SeriesProvenance } from '@/lib/series-provenance'

/**
 * Says what a metric is made of: how many days of series, and how many of them
 * were reconstructed by the historical backfill rather than measured.
 *
 * A dumb renderer on purpose. The copy and the tone come from provenanceLabel,
 * which is a pure function so the logic stays testable outside React.
 */
export default function ProvenanceNote({ provenance }: { provenance?: SeriesProvenance }) {
  const label = provenanceLabel(provenance)
  if (!label) return null

  return (
    <span className={`block text-[13px] ${label.tone === 'warn' ? 'text-warn' : 'text-ink-3'}`}>
      {label.text}
    </span>
  )
}
