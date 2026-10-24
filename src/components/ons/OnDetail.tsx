import type { ReactNode } from 'react'
import OnPriceChart from './OnPriceChart'
import OnSchedule from './OnSchedule'
import OnSimulator from './OnSimulator'
import OnSourceChip from './OnSourceChip'
import type { OnAnalysis } from '@/lib/on-analytics'
import type { PricePoint } from '@/lib/on-catalog'
import type { F } from '@/lib/on-terms'
import { lineLabel, eventLabel, TAX_COPY, fmtBp, fmtDate, fmtNum, fmtPct, fmtVn, plazaCopy, rateTypeLabel, safeHref } from '@/lib/on-format'
import { argentinaDate, formatAge } from '@/lib/utils'
import { SectionHead } from '@/components/resumen/ui'
import { BackLink, Disclosure, Glossary, Metric, Metrics, Notice, Tag, type GlossaryTerm } from './ui'

interface Props {
  analysis: OnAnalysis
  history: PricePoint[]
  asOf: string | null
  stale: boolean
  prices: { ok: boolean; quiet?: boolean; fetchedAt: string | null }
  today?: string // ISO; defaults to today in Argentina. Also fixes the simulator's purchase date when given.
}

const SRC_WARREN = 'Warren (cálculo propio)'
const BDC_LABEL = { following: 'Siguiente día hábil', modified_following: 'Siguiente día hábil modificado', preceding: 'Día hábil anterior' }
// odd/tasks/ux-ons-y-operaciones.md S3: at most five facts on top; everything else is collapsed below.
const FACTS_GRID = 'grid-cols-5 max-[1080px]:grid-cols-3 max-[819px]:grid-cols-2'
const BASE_TERMS: GlossaryTerm[] = ['TIR', 'Valor nominal (VN)', 'Lámina mínima', 'Cupón', 'Amortización', 'Tipo de tasa', 'Ley', 'Plaza de pago']
const PRICED_TERMS: GlossaryTerm[] = ['Precio sucio y limpio', 'Paridad', 'Valor técnico', 'Duración', 'Duración Macaulay', 'Convexidad', 'Vida promedio', 'Tasa corriente', 'Spread']

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[14rem_minmax(0,1fr)] items-baseline gap-4 border-b border-line py-2.5 last:border-b-0 max-[819px]:grid-cols-1 max-[819px]:gap-1">
      <dt className="text-ink-3">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 break-words">{children}</dd>
    </div>
  )
}

const chip = <T,>(f: F<T>) => <OnSourceChip prov={f.prov} sourceUrl={f.sourceUrl} verifiedAt={f.verifiedAt} />

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "en 1 año y 6 meses", by calendar months between two ISO dates. */
function timeUntil(from: string, to: string): string {
  if (to <= from) return 'Ya venció'
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0)
  if (months < 1) return 'en menos de un mes'
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return `en ${plural(rest, 'mes', 'meses')}`
  return `en ${plural(years, 'año', 'años')}${rest ? ` y ${plural(rest, 'mes', 'meses')}` : ''}`
}

/** What the next payment pays, as a share of the face value. */
function nextPayText(coupon: number | null, amort: number): string {
  const interest = coupon === null ? 'interés según la tasa variable' : coupon > 0 ? `${fmtPct(coupon)} de interés` : null
  const capital = amort > 0 ? `devuelve el ${fmtPct(amort)} del capital` : null
  if (interest && capital) return `Paga ${interest} y ${capital}`
  if (interest) return `Paga ${interest}`
  return capital ? capital[0].toUpperCase() + capital.slice(1) : ''
}

function Facts({ analysis, today, fetchedAt }: { analysis: OnAnalysis; today: string; fetchedAt: string | null }) {
  const { row, detail } = analysis
  const priced = row.status === 'ok' && row.price !== null
  const flag = row.methodFlag
  const next = detail.schedule.find((s) => s.payDate === row.nextPayDate)
  const lot = detail.terms.minDenomination.value
  const dollar = row.plaza === 'CCL' ? 'cable' : 'MEP'
  // One short caveat under the TIR; the full text is in "Datos técnicos".
  const caveat = flag
    ? 'Cálculo sin verificar: difiere de BYMA. El detalle está en Datos técnicos.'
    : row.lineFallback && row.priceLine !== 'O'
      ? `No incluye el canje a dólar ${dollar}.`
      : row.priceQuality === 'no-trades'
        ? 'Hoy no hubo operaciones: puede no ser representativa.'
        : row.shortDated
          ? 'Vence en menos de 90 días: es muy sensible al precio.'
          : null
  const unpriced = row.rateType === 'floating'
    ? 'Tasa variable: no se puede calcular cuánto rinde, porque no se conocen los cupones futuros.'
    : row.currency !== 'USD'
      ? 'Esta ON no cotiza en dólares: no se calcula cuánto rinde.'
      : row.status === 'no-price'
        ? 'Sin precio en dólares hoy: no se puede calcular cuánto rinde. En el simulador podés usar un precio propio.'
        : 'Con el precio de hoy no se pudo calcular cuánto rinde.'

  return (
    <section aria-label="Lo principal" className="min-w-0">
      <Metrics className={FACTS_GRID}>
        {priced ? (
          <>
            <Metric label="Precio" value={fmtNum(row.price)} hint="En dólares, por cada 100 de valor nominal" valueClass="text-xl" />
            <Metric label="TIR (rinde por año)" value={fmtPct(row.ytmPct)} valueClass="text-xl">
              {caveat && <span className="text-warn">{caveat}</span>}
            </Metric>
          </>
        ) : (
          <Metric label="Precio y TIR" value={unpriced} valueClass="text-base font-normal text-ink-2" className="col-span-2" />
        )}
        <Metric label="Vencimiento" value={fmtDate(row.maturityDate)} hint={timeUntil(today, row.maturityDate)} valueClass="text-xl" />
        <Metric
          label="Próximo pago"
          value={row.nextPayDate ? fmtDate(row.nextPayDate) : '—'}
          hint={next ? nextPayText(next.couponPct, next.amortPct) : 'Sin pagos futuros'}
          valueClass="text-xl"
        />
        <Metric
          label="Lámina mínima"
          value={lot === null ? 'Sin dato' : fmtVn(lot)}
          hint={lot !== null && priced ? `Unos USD ${fmtNum((lot * (row.price ?? 0)) / 100, 0)} al precio de hoy` : lot === null ? 'No está cargada para esta ON' : undefined}
          valueClass={lot === null ? 'text-xl text-ink-2' : 'text-xl'}
        />
      </Metrics>
      <p className="mt-3 text-[13px] text-ink-3">
        {priced && `Precio de data912 (${lineLabel(row.priceLine, row.cclUsed)}${fetchedAt ? `, ${formatAge(fetchedAt)}` : ''}); la TIR la calcula Warren. `}
        Informativo, no es una recomendación de inversión.
      </p>
    </section>
  )
}

function Technical({ analysis, fetchedAt }: { analysis: OnAnalysis; fetchedAt: string | null }) {
  const { row, detail } = analysis
  const flag = row.methodFlag
  const note = row.termsNote
  return (
    <Disclosure id="on-technical" title="Datos técnicos" summary="Precio limpio, paridad, duración, TIR de BYMA y más">
      <p className="mb-2 max-w-[80ch] text-[13px] text-ink-3">Salvo que se indique otra fuente, los cálculos son de Warren con el precio de data912.</p>
      <Metrics>
        <Metric label="Precio sucio" value={fmtNum(row.price)} hint={`data912, ${lineLabel(row.priceLine, row.cclUsed)}${fetchedAt ? ` · ${formatAge(fetchedAt)}` : ''}`}>
          {row.priceLine === 'O' && row.cclUsed && (
            <span>Precio implícito: línea O (pesos) ÷ CCL de ${fmtNum(row.cclUsed.rate)} (CCL al {fmtDate(row.cclUsed.asOf.slice(0, 10))}).</span>
          )}
          {row.lineFallback && row.priceLine !== 'O' && (
            <span className="text-warn">Atención: precio de la línea {row.priceLine}; esta ON paga en dólar {row.plaza === 'CCL' ? 'cable' : 'MEP'}: la TIR no incluye el canje.</span>
          )}
        </Metric>
        <Metric label="Precio limpio" value={fmtNum(detail.clean)} hint="Sin los intereses acumulados" />
        <Metric label="Intereses devengados" value={fmtNum(detail.accrued, 4)} hint="Acumulados desde el último cupón" />
        <Metric label="Paridad" value={fmtPct(row.paridadPct)} />
        <Metric label={row.priceLine === 'O' ? 'TIR Warren (precio en dólares, implícito O ÷ CCL)' : `TIR Warren (precio en dólares, línea ${row.priceLine})`} value={fmtPct(row.ytmPct)}>
          {row.priceQuality === 'no-trades' && <span className="text-warn">Atención: precio de referencia sin operaciones en la línea {row.priceLine}{row.priceLine === 'O' ? ' (pesos)' : ''} en la rueda; la TIR puede no ser representativa.</span>}
          {row.shortDated && <span>Vence en menos de 90 días: la TIR es muy sensible al precio y poco representativa.</span>}
          {flag && (
            <span className="rounded bg-warn-soft px-2 py-1 text-warn">
              Cálculo no verificado: difiere de BYMA (BYMA {fmtPct(flag.bymaYtmPct)} · Warren {fmtPct(flag.methodYtmPct)}, {fmtBp(flag.diffBp)}, control del {fmtDate(flag.asOf)}). Ninguno es definitivo.
            </span>
          )}
          {!flag && note && (
            <span>Con los términos de Warren la TIR es {fmtPct(note.termsYtmPct)}; BYMA informa {fmtPct(note.bymaYtmPct)} ({fmtBp(note.diffBp)}): difiere de BYMA por convención de intereses. Es informativo.</span>
          )}
        </Metric>
        {row.bymaYtm && (
          <Metric label="TIR BYMA (precio en pesos ÷ MEP)" value={fmtPct(row.bymaYtm.pct)} hint={`BYMA Educa · ${fmtDate(row.bymaYtm.asOf)}`}>
            <span>Ambas TIR son válidas y pueden diferir porque parten de precios distintos: la de BYMA usa el precio en pesos dividido por el MEP; la de Warren, el precio en dólares.</span>
          </Metric>
        )}
        {detail.ytw && (
          <Metric label="Rendimiento al peor (YTW)" value={fmtPct(detail.ytw.ytwPct)}>
            <span>{detail.ytw.kind === 'call' ? `Hasta rescate el ${fmtDate(detail.ytw.workoutDate)}` : `Hasta vencimiento el ${fmtDate(detail.ytw.workoutDate)}`}</span>
          </Metric>
        )}
        <Metric label="Tasa corriente" value={fmtPct(row.currentYieldPct)} hint="Sobre el precio limpio" />
        <Metric label="Duración modificada" value={`${fmtNum(row.mdYears)} años`} />
        <Metric label="Duración Macaulay" value={`${fmtNum(detail.macaulayYears)} años`} />
        <Metric label="Convexidad" value={fmtNum(detail.convexity)} />
        <Metric label="Vida promedio (WAL)" value={`${fmtNum(row.walYears)} años`} />
        <Metric label="Spread vs. soberana" value={fmtBp(row.spreadBp)} hint="Referencial, con la curva soberana de BYMA Educa" />
      </Metrics>
    </Disclosure>
  )
}

function Terms({ analysis }: { analysis: OnAnalysis }) {
  const { row, detail } = analysis
  const t = detail.terms
  const lot = (f: F<number | null>, unknown: string) => (f.value === null ? <span className="text-ink-3">{unknown}</span> : <span>{fmtVn(f.value)}</span>)
  return (
    <Disclosure id="on-terms" title="Condiciones de emisión" summary="Emisor, cupón, lámina mínima y de dónde sale cada dato">
      {detail.warnings.length > 0 && (
        <div className="mb-3">
          <Notice>Hay datos curados que no se pudieron leer ({detail.warnings.map((w) => w.field).join(', ')}) y se usaron los valores por defecto.</Notice>
        </div>
      )}
      <p className="mb-2 max-w-[80ch] text-[13px] text-ink-3">
        Cada dato dice de dónde sale: <b className="font-medium text-ink-2">verificado</b>, contra el prospecto (con la fecha y el enlace);{' '}
        <b className="font-medium text-ink-2">BYMA</b>, de BYMA Educa sin verificar contra el prospecto; <b className="font-medium text-ink-2">sin verificar</b>, de una fuente secundaria o el valor por defecto según la ley.
      </p>
      <dl>
        <Term label="Emisor">{row.issuer ?? 'sin dato'}{row.description ? ` · ${row.description}` : ''}</Term>
        <Term label="Tickers">{[row.tickerO, row.tickerD, detail.tickerC].filter(Boolean).join(' · ')}</Term>
        <Term label="Plaza de pago"><span>{plazaCopy(t.paymentPlaza.value)}</span>{chip(t.paymentPlaza)}</Term>
        <Term label="Monto emitido">
          {t.issuedAmount.value === null ? <span className="text-ink-3">sin dato</span> : <span>{fmtVn(t.issuedAmount.value)}</span>}
          {t.issuedAmount.prov !== 'byma' && t.issuedAmount.value !== null && chip(t.issuedAmount)}
          {t.issuedAmountByma !== null && t.issuedAmount.prov === 'byma' && <span className="text-[13px] text-ink-3">según BYMA, puede estar desactualizado</span>}
          {t.issuedAmountByma !== null && t.issuedAmount.prov !== 'byma' && t.issuedAmount.value !== t.issuedAmountByma && (
            <span className="text-[13px] text-ink-3">{fmtVn(t.issuedAmountByma)} según BYMA, puede estar desactualizado</span>
          )}
        </Term>
        <Term label="Emisión / vencimiento">{fmtDate(detail.issueDate)} → {fmtDate(row.maturityDate)}</Term>
        <Term label="Cupón">{detail.couponRatePct === null ? 'Sin cupón' : `${fmtPct(detail.couponRatePct, 4)} anual`}{detail.frequency ? ` · ${detail.frequency}` : ''}</Term>
        <Term label="Base de cálculo"><span>{t.dayCount.value}</span>{chip(t.dayCount)}</Term>
        <Term label="Día hábil (pagos)"><span>{BDC_LABEL[t.bdc.value]}</span>{chip(t.bdc)}</Term>
        <Term label="Día hábil (vencimiento)"><span>{BDC_LABEL[t.maturityBdc.value]}</span>{chip(t.maturityBdc)}</Term>
        <Term label="Fecha de registro">
          {t.recordOffsetDays.value === null ? <span className="text-ink-3">sin fecha de registro cargada</span> : <span>{t.recordOffsetDays.value} días corridos antes del pago</span>}
          {chip(t.recordOffsetDays)}
        </Term>
        <Term label="Lámina mínima (VN)">{lot(t.minDenomination, 'lámina mínima desconocida')}{chip(t.minDenomination)}</Term>
        <Term label="Unidad mínima de negociación">{lot(t.minTradeUnit, 'sin dato')}{chip(t.minTradeUnit)}</Term>
        <Term label="Múltiplo (incremento)">{lot(t.increment, 'sin dato')}{chip(t.increment)}</Term>
        {t.calls.value.length === 0 && t.puts.value.length === 0 && (
          <Term label="Rescate y venta anticipados"><span className="text-ink-2">Sin opciones de rescate registradas</span>{chip(t.calls)}</Term>
        )}
        {row.events.length > 0 && (
          <Term label="Eventos">
            <ul className="grid gap-1">
              {row.events.map((e) => {
                const href = safeHref(e.sourceUrl)
                return (
                  <li key={`${e.kind}-${e.eventDate}`}>
                    {eventLabel(e.kind)} {fmtDate(e.eventDate)}{e.note ? `: ${e.note}` : ''}
                    {href && <> · <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center font-medium text-accent-ink underline-offset-2 hover:underline max-[819px]:min-h-11">ver fuente</a></>}
                  </li>
                )
              })}
            </ul>
          </Term>
        )}
      </dl>
    </Disclosure>
  )
}

function Options({ analysis }: { analysis: OnAnalysis }) {
  const t = analysis.detail.terms
  if (t.calls.value.length === 0 && t.puts.value.length === 0) return null
  return (
    <Disclosure id="on-calls" title="Opciones de rescate y venta" summary="Cuándo la empresa puede rescatarla antes o vos venderla">
      <div className="grid gap-2">
        {t.calls.value.length > 0 && (
          <>
            <p className="flex flex-wrap items-center gap-2"><span>Rescate anticipado del emisor</span>{chip(t.calls)}</p>
            <ul className="list-disc space-y-1 pl-5 tabular-nums">
              {t.calls.value.map((c) => (
                <li key={c.from}>Desde {fmtDate(c.from)}{c.to ? ` hasta ${fmtDate(c.to)}` : ' sin fecha límite'}: {fmtPct(c.pricePct)} del valor residual</li>
              ))}
            </ul>
          </>
        )}
        {t.puts.value.length > 0 && (
          <>
            <p className="flex flex-wrap items-center gap-2"><span>Opciones de venta del inversor</span>{chip(t.puts)}</p>
            <ul className="list-disc space-y-1 pl-5 tabular-nums">
              {t.puts.value.map((p, i) => (
                <li key={`${p.kind}-${i}`}>
                  {p.kind === 'change_of_control' ? 'Por cambio de control' : p.kind}: {fmtPct(p.pricePct)}{p.note ? ` · ${p.note}` : ''}
                  {p.kind === 'change_of_control' && ' (contingente: solo informativo, no entra en la TIR)'}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="text-[13px] text-ink-3">El rendimiento al peor considera solo rescates con fecha cierta; las opciones contingentes no se incluyen.</p>
      </div>
    </Disclosure>
  )
}

export default function OnDetail({ analysis, history, asOf, stale, prices, today }: Props) {
  const { row, detail } = analysis
  const priced = row.status === 'ok' && row.price !== null
  const glossary: GlossaryTerm[] = [...BASE_TERMS, ...(priced ? PRICED_TERMS : []), ...(detail.ytw ? (['YTW'] as GlossaryTerm[]) : [])]

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 max-[819px]:gap-8">
      <header>
        <BackLink href="/ons">Volver al listado</BackLink>
        <h1 className="font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl">{row.tickerO}</h1>
        <p className="mt-1 break-words text-ink-2">{row.issuer ?? 'Emisor sin dato'}{row.description ? ` · ${row.description}` : ''}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Tag tone="neutral">{row.currencyLabel} · Ley {row.law === 'ARG' ? 'argentina' : 'Nueva York'}</Tag>
          <Tag tone="neutral">{rateTypeLabel(row.rateType)}</Tag>
          {row.events.map((e) => <Tag key={`${e.kind}-${e.eventDate}`} tone="info">{eventLabel(e.kind)} {fmtDate(e.eventDate)}</Tag>)}
          <span className="text-xs text-ink-3">ISIN {row.isin}</span>
        </div>
      </header>

      {(stale || (prices.ok && prices.quiet) || !prices.ok) && (
        <div className="-mt-4 grid gap-2">
          {stale && <Notice>Catálogo desactualizado: los datos de BYMA Educa son del {fmtDate(asOf)}.</Notice>}
          {prices.ok && prices.quiet && <Notice>Mercado sin operaciones aún hoy: se muestran los precios de la última rueda.</Notice>}
          {!prices.ok && <Notice>Precios no disponibles en este momento (data912): no se calculan TIR ni duración.</Notice>}
        </div>
      )}

      <Facts analysis={analysis} today={today ?? argentinaDate()} fetchedAt={prices.fetchedAt} />

      <OnSimulator analysis={analysis} today={today} />

      <section aria-labelledby="on-history" className="min-w-0">
        <SectionHead id="on-history" title="Historial de precio" />
        <div className="pt-4">
          <p className="mb-2 text-[13px] text-ink-3">Precio sucio de la línea D · data912</p>
          <OnPriceChart history={history} ticker={row.tickerD} />
        </div>
      </section>

      <div className="min-w-0 border-t border-line">
        {priced && <Technical analysis={analysis} fetchedAt={prices.fetchedAt} />}
        <Disclosure id="on-schedule" title="Cronograma de pagos (% del valor nominal)" summary={plural(detail.schedule.length, "pago", "pagos")}>
          <OnSchedule schedule={detail.schedule} floating={row.rateType === 'floating'} />
        </Disclosure>
        <Terms analysis={analysis} />
        <Options analysis={analysis} />
        <Disclosure id="on-taxes" title="Impuestos">
          <p className="max-w-[80ch] text-ink-2">{TAX_COPY}</p>
        </Disclosure>
        <Disclosure id="on-sources" title="Fuentes de los datos">
          <p className="max-w-[80ch] text-ink-2">
            Términos y cronograma de BYMA Educa (datos al {fmtDate(detail.asOf)}) con condiciones curadas por Warren; precios de data912 (precio sucio).
            TIR, duración, convexidad, paridad, tasa corriente, vida promedio, spread y simulación: {SRC_WARREN}.
          </p>
        </Disclosure>
        <Glossary terms={glossary} />
      </div>
    </div>
  )
}
