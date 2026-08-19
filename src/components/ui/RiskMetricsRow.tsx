'use client'

import ProvenanceNote from '@/components/ui/ProvenanceNote'
import type { SeriesProvenance } from '@/lib/series-provenance'

/**
 * The risk metrics of the General tab, computed over the MEASURABLE base
 * (stocks + cash) while the chart above it draws the FULL portfolio. That
 * scope difference is deliberate (design A2): the chart answers "how much do
 * I have?" and every peso counts; the metrics answer "how much risk am I
 * running?" and only what can be measured honestly counts. The scope line
 * below the cards is what turns that from a contradiction into two questions
 * answered correctly — it is not decoration.
 *
 * A null metric is rendered as "Sin datos suficientes", never as 0: below the
 * A3 interval thresholds the API returns null precisely because a number
 * there would be noise wearing a number's clothes.
 */

/** Structural subset of the statistics payload this row consumes. */
export interface RiskMetricsData {
  sharpeRatio: number | null
  annualizedVol: number | null
  maxDrawdown: number | null
  returnIntervals?: number
  drawdownIntervalsSkipped?: number
  provenance?: SeriesProvenance
}

const CARD_CLASS = 'glass rounded-xl px-4 py-3 animate-slide-up'
const LABEL_CLASS = 'text-[10px] font-mono text-slate-600 uppercase tracking-widest'
const CAPTION_CLASS = 'text-[10px] text-slate-500 font-mono'
const VALUE_CLASS = 'font-display font-700 text-xl mt-0.5'

function EmptyMetric() {
  return (
    <>
      <p className={`${VALUE_CLASS} text-slate-500`}>—</p>
      <p className={CAPTION_CLASS}>Sin datos suficientes</p>
    </>
  )
}

export default function RiskMetricsRow({ data }: { data: RiskMetricsData | null }) {
  // Tolerant fetch: a failed metrics request loses the row, not the page.
  if (!data) return null

  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className={CARD_CLASS} style={{ animationDelay: '240ms', animationFillMode: 'both' }}>
          <p className={LABEL_CLASS}>Sharpe Ratio</p>
          {data.sharpeRatio !== null && data.sharpeRatio !== undefined ? (
            <>
              <p className={`${VALUE_CLASS} ${data.sharpeRatio >= 1 ? 'text-emerald' : data.sharpeRatio >= 0 ? 'text-amber' : 'text-rose'}`}>
                {data.sharpeRatio.toFixed(2)}
              </p>
              <p className={CAPTION_CLASS}>
                Anualizado · {data.returnIntervals ?? 0} retornos diarios
              </p>
              <ProvenanceNote provenance={data.provenance} />
            </>
          ) : (
            <EmptyMetric />
          )}
        </div>

        <div className={CARD_CLASS} style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
          <p className={LABEL_CLASS}>Volatilidad Anual</p>
          {data.annualizedVol !== null && data.annualizedVol !== undefined ? (
            <>
              <p className={`${VALUE_CLASS} text-white`}>
                {(data.annualizedVol * 100).toFixed(1)}%
              </p>
              <p className={CAPTION_CLASS}>
                Anualizada · {data.returnIntervals ?? 0} retornos diarios
              </p>
              <ProvenanceNote provenance={data.provenance} />
            </>
          ) : (
            <EmptyMetric />
          )}
        </div>

        <div className={CARD_CLASS} style={{ animationDelay: '360ms', animationFillMode: 'both' }}>
          <p className={LABEL_CLASS}>Max Drawdown</p>
          {data.maxDrawdown !== null && data.maxDrawdown !== undefined ? (
            <>
              <p className={`${VALUE_CLASS} ${data.maxDrawdown < -0.1 ? 'text-rose' : 'text-slate-300'}`}>
                {(data.maxDrawdown * 100).toFixed(1)}%
              </p>
              <p className={CAPTION_CLASS}>Caída máxima desde pico</p>
              <ProvenanceNote provenance={data.provenance} />
              {(data.drawdownIntervalsSkipped ?? 0) > 0 && (
                <p className="text-[10px] text-amber/70 font-mono">
                  {data.drawdownIntervalsSkipped} intervalos omitidos
                </p>
              )}
            </>
          ) : (
            <EmptyMetric />
          )}
        </div>
      </div>

      <p className="text-[10px] font-mono text-slate-600 mt-2">
        sobre acciones + caja · ONs excluidas (sin historial)
      </p>
    </div>
  )
}
