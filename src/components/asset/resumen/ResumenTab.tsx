'use client'

import { useId } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AssetPage, AssetProfile } from '@/lib/fundamentals/service'
import { METRICS, type MetricId } from '@/lib/fundamentals/catalog'
import { formatMetric, periodLabel } from '@/lib/fundamentals/explain'
import { businessAnswer, countryName, priceAnswer, sectorName, spoken, type Answer, type Tone } from '@/lib/fundamentals/summary'
import { tag, type TagTone } from '@/components/ons/ui'
import { argentinaDate, cn, formatNumber } from '@/lib/utils'

// min-w-0: a grid item never widens the page past its column; wide content (the results table) scrolls inside.
const CARD = 'min-w-0 rounded-lg border border-line bg-surface p-4'
const TONE: Record<Tone, TagTone> = { ok: 'ok', neutral: 'neutral', warn: 'warn', bad: 'danger' }
/** "46 %" never breaks before its sign. */
const NB = '\u00a0'
const keepPct = (s: string) => s.replace(/ %/g, `${NB}%`)
const longDate = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn(CARD, className)}>
      <h3 id={id} className="text-[17px] font-semibold leading-tight">{title}</h3>
      {children}
    </section>
  )
}

/** One question: a pill that names a fact, the sentence, and the Números rows it reads. */
function AnswerCard({ question, answer, page, onOpen }: { question: string; answer: Answer; page: AssetPage; onOpen: (id: MetricId) => void }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={CARD}>
      <h3 id={id} className="text-[15px] font-semibold text-ink-2">{question}</h3>
      {answer.tone && (
        <p className="mt-3">
          <span data-tone={answer.tone} className={cn(tag(TONE[answer.tone]), 'min-h-7 px-2.5 text-[15px]')}>{answer.label}</span>
        </p>
      )}
      <p className="mt-2 max-w-prose text-[17px] leading-snug">{keepPct(answer.text)}</p>
      {answer.facts.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {answer.facts.map((m) => {
            const def = METRICS.find((d) => d.id === m)!
            return (
              // At 320 px a long label wraps inside its button instead of widening the page.
              <li key={m} className="max-w-full">
                <button
                  type="button"
                  onClick={() => onOpen(m)}
                  className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-left text-[15px] text-ink-2 hover:bg-hover hover:text-ink"
                >
                  {def.label} <span className="whitespace-nowrap font-mono font-medium text-ink">{formatMetric(page.metrics?.[m].today, def.unit)}</span>
                  <ChevronRight className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** "33 % arriba", "en el máximo": how far today is from a reference, in the words the card uses. */
const away = (share: number, side: string, at: string) => (share > 0 ? `${spoken(share * 100)}${NB}% ${side}` : at)

/** Label and value rows; `hint` says in plain words what the label means, `lang` marks a value left in English. */
export type Fact = { k: string; v: string | null | undefined; lang?: string; hint?: string; tone?: string }

/** A card's facts, those with a value; null when none has one. */
export function Facts({ rows }: { rows: Fact[] }) {
  const shown = rows.filter((r) => r.v)
  if (shown.length === 0) return null
  return (
    <dl className="mt-2">
      {shown.map(({ k, v, lang, hint, tone }) => (
        <div key={k} className="flex min-h-11 items-center justify-between gap-4 border-t border-line py-2 text-[15px] first:border-t-0">
          <dt className={hint ? 'text-ink' : 'text-ink-2'}>
            {k}
            {hint && <span className="mt-0.5 block max-w-[40ch] leading-snug text-ink-2">{hint}</span>}
          </dt>
          <dd lang={lang} className={cn('text-right font-medium', tone)}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The low and high of 52 weeks; today's price marked only when both are in the same currency. */
export function Range({ page, p, same }: { page: AssetPage; p: AssetProfile; same: boolean }) {
  const { fiftyTwoWeekLow: low, fiftyTwoWeekHigh: high } = p
  if (low === null || high === null || !(high > low) || !(low > 0)) return <p className="mt-3 text-[15px] text-ink-2">Sin datos del rango de 52 semanas.</p>
  const fmt = (v: number) => formatMetric(v, 'price', p.currency ?? page.currency)
  const at = Math.min(1, Math.max(0, (page.price - low) / (high - low)))
  const today = `Hoy ${fmt(page.price)}: ${away(page.price / low - 1, 'arriba del mínimo', 'en el mínimo')} y ${away(1 - page.price / high, 'abajo del máximo', 'en el máximo')}.`
  return (
    <>
      <div role="img" aria-label={`Mínimo ${fmt(low)}, máximo ${fmt(high)}.${same ? ` ${today}` : ''}`} className="relative mx-1 mt-5 h-2 rounded-full bg-surface-2">
        {same && <span data-mark className="absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${Math.round(at * 100)}%` }} />}
      </div>
      <div className="mt-3 flex justify-between gap-4 text-[15px]">
        <p><span className="block text-ink-2">Mínimo</span><span className="font-mono font-medium">{fmt(low)}</span></p>
        <p className="text-right"><span className="block text-ink-2">Máximo</span><span className="font-mono font-medium">{fmt(high)}</span></p>
      </div>
      {same && <p className="mt-3 text-[15px]">{today}</p>}
    </>
  )
}

/** The analysts' average target and how many set one: information, with its footnote. */
function Analysts({ page, p, same }: { page: AssetPage; p: AssetProfile; same: boolean }) {
  const { targetMeanPrice: target, numberOfAnalystOpinions: count } = p
  if (target === null || !count) return <p className="mt-3 text-[15px] text-ink-2">No tenemos precios objetivo de analistas para esta acción.</p>
  const up = target / page.price - 1
  return (
    <>
      <p className="mt-3 font-mono text-[1.75rem] font-semibold leading-tight">{formatMetric(target, 'price', p.currency ?? page.currency)}</p>
      <p className="mt-1 text-[15px]">
        Precio objetivo promedio según {count} {count === 1 ? 'analista' : 'analistas'}
        {same && `: ${spoken(Math.abs(up) * 100)}${NB}% ${up >= 0 ? 'arriba' : 'abajo'} del precio de hoy`}.
      </p>
      <p data-footnote className="mt-3 border-t border-line pt-3 text-[15px] text-ink-2">Es información, no una recomendación de compra o venta.</p>
    </>
  )
}

const eps = (v: number | null) => (v === null ? '—' : formatNumber(v, { decimals: 2 }))
const VERDICT = { ok: 'Superó', warn: 'No llegó', neutral: 'Igual' } as const

/** The next earnings date and each of the last four quarters' earnings per share, expected against actual. */
function Results({ p }: { p: AssetProfile }) {
  // A last good copy can outlive the date it announced.
  const next = p.nextEarningsDate !== null && p.nextEarningsDate >= argentinaDate() ? p.nextEarningsDate : null
  return (
    <>
      <p className="mt-3 text-[15px]">
        {next ? `Próximos resultados: ${longDate.format(new Date(`${next}T00:00:00Z`))}.` : 'Todavía no hay fecha para sus próximos resultados.'}
      </p>
      {p.earnings.length === 0 ? (
        <p className="mt-2 text-[15px] text-ink-2">Sin resultados trimestrales con estimaciones.</p>
      ) : (
        <>
          <p className="mt-3 text-[15px] text-ink-2">Ganancia por acción de cada trimestre: lo que esperaban los analistas y lo que ganó.</p>
          {/* Under ~355 px its four columns do not fit at 15 px: the table scrolls inside its card, never the page. */}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="text-left text-ink-2">
                  <th scope="col" className="py-2 pr-2 font-medium">Trimestre</th>
                  <th scope="col" className="py-2 pr-2 text-right font-medium">Esperado</th>
                  <th scope="col" className="py-2 pr-2 text-right font-medium">Real</th>
                  <th scope="col" className="py-2"><span className="sr-only">Resultado</span></th>
                </tr>
              </thead>
              <tbody>
                {p.earnings.map((e) => {
                  const { epsEstimate: est, epsActual: real } = e
                  const tone = est === null || real === null ? null : real > est ? 'ok' : real < est ? 'warn' : 'neutral'
                  return (
                    <tr key={e.quarterEnd} className="border-t border-line">
                      <td className="py-2 pr-2">{periodLabel(e.quarterEnd, 'quarterly')}</td>
                      <td className="py-2 pr-2 text-right font-mono">{eps(est)}</td>
                      <td className="py-2 pr-2 text-right font-mono font-medium">{eps(real)}</td>
                      <td className="py-2 text-right">
                        {tone && <span className={cn(tag(tone), 'text-[15px]')}>{VERDICT[tone]}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

/**
 * The "Resumen" tab (odd/tasks/asset-page.md T9, S11): the two first-ten-seconds answers from the
 * page's own numbers, each linking to its Números rows, then the 52-week range, the analysts'
 * target, the earnings and who the company is. Facts, never advice.
 */
export function ResumenTab({ page, onOpen }: { page: AssetPage; onOpen: (id: MetricId) => void }) {
  const p = page.profile ?? null
  // Yahoo's prices compare with the header's only in the same currency (an ADR's own, a BYMA listing's pesos).
  const same = !p?.currency || !page.currency || p.currency === page.currency
  // As Números counts them, so the page says one number; Yahoo's only without it.
  const employees = page.metrics?.employees.today ?? p?.fullTimeEmployees ?? null
  const company: Fact[] = [
    { k: 'Sector', v: p?.sector && sectorName(p.sector) },
    // Yahoo's industries stay in English: about 150 of them, and their names are what people search.
    { k: 'Industria', v: p?.industry, lang: 'en' },
    { k: 'País', v: p?.country && countryName(p.country) },
    { k: 'Empleados', v: employees === null ? null : formatNumber(employees, { decimals: 0 }) },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <AnswerCard question="¿Le va bien como empresa?" answer={businessAnswer(page)} page={page} onOpen={onOpen} />
      <AnswerCard question="¿Está cara?" answer={priceAnswer(page)} page={page} onOpen={onOpen} />
      {p ? (
        <>
          <Card title="Últimas 52 semanas"><Range page={page} p={p} same={same} /></Card>
          <Card title="Analistas"><Analysts page={page} p={p} same={same} /></Card>
          <Card title="Resultados"><Results p={p} /></Card>
        </>
      ) : (
        <p className="rounded-md bg-surface-2 px-4 py-3 text-[15px] text-ink-2 lg:col-span-2">
          No pudimos traer el rango de 52 semanas, los analistas ni los resultados. Probá de nuevo en un rato.
        </p>
      )}
      {company.some((r) => r.v) && <Card title="La empresa"><Facts rows={company} /></Card>}
    </div>
  )
}
