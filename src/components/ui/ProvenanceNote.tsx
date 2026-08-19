'use client'

import { provenanceLabel } from '@/lib/series-provenance'
import type { SeriesProvenance } from '@/lib/series-provenance'

/**
 * Says what a metric is made of: how many days of series, and how many of them
 * were reconstructed by the historical backfill rather than measured.
 *
 * A dumb renderer on purpose. The copy and the tone come from provenanceLabel,
 * which is a pure function precisely because this repo has no React testing
 * stack — logic that lives in a .tsx file here cannot be tested at all.
 */
export default function ProvenanceNote({ provenance }: { provenance?: SeriesProvenance }) {
  const label = provenanceLabel(provenance)
  if (!label) return null

  return (
    <p
      className={`text-[10px] font-mono ${
        label.tone === 'warn' ? 'text-amber/70' : 'text-slate-600'
      }`}
    >
      {label.text}
    </p>
  )
}
