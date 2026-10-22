import type { ReactNode } from 'react'
import OnPriceChart from './OnPriceChart'
import OnSchedule from './OnSchedule'
import OnSimulator from './OnSimulator'
import OnSourceChip from './OnSourceChip'
import type { OnAnalysis } from '@/lib/on-analytics'
import type { PricePoint } from '@/lib/on-catalog'
import type { F } from '@/lib/on-terms'
import { lineLabel, eventLabel, TAX_COPY, fmtBp, fmtDate, fmtNum, fmtPct, fmtVn, plazaCopy, rateTypeLabel, safeHref } from '@/lib/on-format'
import { formatAge } from '@/lib/utils'
import { SectionHead } from '@/components/resumen/ui'
import { BackLink, Metric, Metrics, Notice, Tag, tag } from './ui'

interface Props {
  analysis: OnAnalysis
  history: PricePoint[]
  asOf: string | null
  stale: boolean
  prices: { ok: boolean; quiet?: boolean; fetchedAt: string | null }
}

const SRC_WARREN = 'Warren (cálculo propio)'
const BDC_LABEL = { following: 'Siguiente día hábil', modified_following: 'Siguiente día hábil modificado', preceding: 'Día hábil anterior' }

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <SectionHead id={id} title={title} />
      <div className="pt-4">{children}</div>
    </section>
  )
}

function Tile({ label, value, source, children, className }: { label: string; value: string; source: string; children?: ReactNode; className?: string }) {
  return <Metric label={label} value={value} hint={source} className={className}>{children}</Metric>
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[14rem_minmax(0,1fr)] items-baseline gap-4 border-b border-line py-2.5 last:border-b-0 max-[819px]:grid-cols-1 max-[819px]:gap-1">
      <dt className="text-ink-3">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 break-words">{children}</dd>
    </div>
  )
}

const chip = <T,>(f: F<T>) => <OnSourceChip prov={f.prov} sourceUrl={f.sourceUrl} verifiedAt={f.verifiedAt} />

const Banner = ({ children }: { children: ReactNode }) => <Notice>{children}</Notice>

export default function OnDetail({ analysis, history, asOf, stale, prices }: Props) {
  const { row, detail } = analysis
  const t = detail.terms
  const priced = row.status === 'ok'
  const floating = row.rateType === 'floating'
  const flag = row.methodFlag
  const note = row.termsNote
  const lot = (f: F<number | null>, unknown: string) => (f.value === null ? <span className="text-ink-3">{unknown}</span> : <span>{fmtVn(f.value)}</span>)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
      <header>
        <BackLink href="/ons">Volver al listado</BackLink>
        <h1 className="font-serif text-[2rem] font-normal leading-tight tracking-[-0.015em] max-[819px]:text-2xl">{row.tickerO}</h1>
        <p className="mt-1 break-words text-ink-3">{row.issuer ?? 'Emisor sin dato'}{row.description ? ` · ${row.description}` : ''} · {row.isin}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Tag tone="neutral">{row.currencyLabel} · Ley {row.law === 'ARG' ? 'argentina' : 'Nueva York'}</Tag>
          <Tag tone="neutral">{rateTypeLabel(row.rateType)}</Tag>
          {floating && <Tag tone="neutral" title="Tasa variable: no se proyectan los cupones, por eso no se calcula TIR ni se puede simular">No simulable</Tag>}
          {row.events.map((e) => {
            const href = safeHref(e.sourceUrl)
            const text = `${eventLabel(e.kind)} ${fmtDate(e.eventDate)}`
            const cls = tag('info')
            return href ? <a key={`${e.kind}-${e.eventDate}`} href={href} target="_blank" rel="noopener noreferrer" title={e.note ?? undefined} className={`${cls} underline-offset-2 hover:underline`}>{text}</a> : <span key={`${e.kind}-${e.eventDate}`} className={cls}>{text}</span>
          })}
        </div>
      </header>

      {(stale || (prices.ok && prices.quiet) || !prices.ok) && (
      <div className="-mt-6 grid gap-2">
      {stale && <Banner>Catálogo desactualizado: los datos de BYMA Educa son del {fmtDate(asOf)}.</Banner>}
      {prices.ok && prices.quiet && <Banner>Mercado sin operaciones aún hoy: se muestran los precios de la última rueda.</Banner>}
      {!prices.ok && <Banner>Precios no disponibles en este momento (data912): no se calculan TIR ni duración.</Banner>}
      </div>
      )}

      <section aria-labelledby="on-metrics" className="min-w-0">
      <SectionHead id="on-metrics" title="Precio y rendimiento" />
      <Metrics>
        {priced ? (
          <>
            <Tile label="Precio sucio" value={fmtNum(row.price)} source={`data912, ${lineLabel(row.priceLine, row.cclUsed)}${prices.fetchedAt ? ` · ${formatAge(prices.fetchedAt)}` : ''}`}>
              {row.priceLine === 'O' && row.cclUsed && (
                <span>
                  Precio implícito: línea O (pesos) ÷ CCL de ${fmtNum(row.cclUsed.rate)} (CCL al {fmtDate(row.cclUsed.asOf.slice(0, 10))}), mismo método que BYMA (CCL implícito de GGAL).
                </span>
              )}
              {row.lineFallback && row.priceLine !== 'O' && (
                <span className="text-warn">
                  Atención: precio de la línea {row.priceLine}; esta ON paga en dólar {row.plaza === 'CCL' ? 'cable' : 'MEP'}: la TIR no incluye el canje.
                </span>
              )}
            </Tile>
            <Tile label="Precio limpio" value={fmtNum(detail.clean)} source={SRC_WARREN} />
            <Tile label="Intereses devengados" value={fmtNum(detail.accrued, 4)} source={SRC_WARREN} />
            <Tile label="Paridad" value={fmtPct(row.paridadPct)} source={SRC_WARREN} />
            <Tile label={row.priceLine === 'O' ? 'TIR Warren (precio en dólares, implícito O ÷ CCL)' : `TIR Warren (precio en dólares, línea ${row.priceLine})`} value={fmtPct(row.ytmPct)} source={SRC_WARREN}>
              {row.priceQuality === 'no-trades' && <span className="text-warn">Atención: precio de referencia sin operaciones en la línea {row.priceLine}{row.priceLine === 'O' ? ' (pesos)' : ''} en la rueda; la TIR puede no ser representativa.</span>}
              {row.shortDated && <span>Vence en menos de 90 días: la TIR es muy sensible al precio y poco representativa.</span>}
              {flag && (
                <span className="rounded bg-warn-soft px-2 py-1 text-warn">
                  Cálculo no verificado: difiere de BYMA (BYMA {fmtPct(flag.bymaYtmPct)} · Warren {fmtPct(flag.methodYtmPct)}, {fmtBp(flag.diffBp)}, control del {fmtDate(flag.asOf)}). Ninguno es definitivo.
                </span>
              )}
              {!flag && note && (
                <span>
                  Con los términos de Warren la TIR es {fmtPct(note.termsYtmPct)}; BYMA informa {fmtPct(note.bymaYtmPct)} ({fmtBp(note.diffBp)}): difiere de BYMA por convención de intereses. Es informativo.
                </span>
              )}
            </Tile>
            {row.bymaYtm && (
              <Tile label="TIR BYMA (precio en pesos ÷ MEP)" value={fmtPct(row.bymaYtm.pct)} source={`BYMA Educa · ${fmtDate(row.bymaYtm.asOf)}`}>
                <span>Ambas TIR son válidas y pueden diferir porque parten de precios distintos: la de BYMA usa el precio en pesos dividido por el MEP; la de Warren, el precio en dólares de la línea D.</span>
              </Tile>
            )}
            {detail.ytw && (
              <Tile
                label="Rendimiento al peor (YTW)"
                value={fmtPct(detail.ytw.ytwPct)}
                source={SRC_WARREN}
              >
                <span>{detail.ytw.kind === 'call' ? `Hasta rescate el ${fmtDate(detail.ytw.workoutDate)}` : `Hasta vencimiento el ${fmtDate(detail.ytw.workoutDate)}`}</span>
              </Tile>
            )}
            <Tile label="Tasa corriente" value={fmtPct(row.currentYieldPct)} source={`${SRC_WARREN} · sobre precio limpio`} />
            <Tile label="Duración modificada" value={`${fmtNum(row.mdYears)} años`} source={SRC_WARREN} />
            <Tile label="Duración Macaulay" value={`${fmtNum(detail.macaulayYears)} años`} source={SRC_WARREN} />
            <Tile label="Convexidad" value={fmtNum(detail.convexity)} source={SRC_WARREN} />
            <Tile label="Vida promedio (WAL)" value={`${fmtNum(row.walYears)} años`} source={SRC_WARREN} />
            <Tile label="Spread vs. soberana" value={fmtBp(row.spreadBp)} source="Opcional · referencial · BYMA Educa + Warren" />
          </>
        ) : (
          <Metric label="Precio y rendimiento" value={floating ? '—' : 'Sin precio'} valueClass="text-ink-2" className="col-span-4 max-[1080px]:col-span-3 max-[819px]:col-span-2">
            <span>
              {floating ? 'Tasa variable: no se calcula TIR ni duración.' : row.currency !== 'USD' ? 'Esta ON no cotiza en dólares: no se calcula TIR con un precio en otra moneda.' : 'No hay cotización de la línea D (dólar MEP): no se calculan TIR, duración ni paridad. Los términos y el cronograma siguen disponibles.'}
            </span>
          </Metric>
        )}
        <Tile label="Próximo pago" value={row.nextPayDate ? fmtDate(row.nextPayDate) : '—'} source={row.nextPayAmountPct !== null ? `${fmtNum(row.nextPayAmountPct, 4)}% del VN original · fecha ajustada por día hábil` : 'Sin pagos futuros'} />
      </Metrics>
      </section>

      <Section id="on-history" title="Historial de precio">
        <p className="mb-2 text-[13px] text-ink-3">Precio sucio de la línea D · data912</p>
        <OnPriceChart history={history} ticker={row.tickerD} />
      </Section>

      <Section id="on-schedule" title="Cronograma de pagos">
        <OnSchedule schedule={detail.schedule} floating={floating} />
      </Section>

      <OnSimulator analysis={analysis} />

      <Section id="on-terms" title="Condiciones de emisión">
        <dl>
          <Term label="Emisor">{row.issuer ?? 'sin dato'}{row.description ? ` · ${row.description}` : ''}</Term>
          <Term label="Tickers">{[row.tickerO, row.tickerD, detail.tickerC].filter(Boolean).join(' · ')}</Term>
          <Term label="Plaza de pago"><span>{plazaCopy(t.paymentPlaza.value)}</span>{chip(t.paymentPlaza)}</Term>
          <Term label="Monto emitido">
            {t.issuedAmount.value === null ? <span className="text-ink-3">sin dato</span> : <span>{fmtVn(t.issuedAmount.value)}</span>}
            {t.issuedAmount.prov !== 'byma' && t.issuedAmount.value !== null && chip(t.issuedAmount)}
            {t.issuedAmountByma !== null && (t.issuedAmount.prov === 'byma' || t.issuedAmount.value !== t.issuedAmountByma) && (
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
        </dl>
      </Section>

      <Section id="on-calls" title="Opciones de rescate y venta">
        <div className="grid gap-2">
          {t.calls.value.length === 0 ? (
            <p className="flex flex-wrap items-center gap-2"><span className="text-ink-2">Sin opciones de rescate registradas</span>{chip(t.calls)}</p>
          ) : (
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
      </Section>

      {detail.warnings.length > 0 && (
        <Banner>Hay datos curados que no se pudieron leer ({detail.warnings.map((w) => w.field).join(', ')}) y se usaron los valores por defecto.</Banner>
      )}

      <Section id="on-taxes" title="Impuestos">
        <p className="max-w-[80ch] text-ink-2">{TAX_COPY}</p>
      </Section>

      <p className="max-w-[96ch] text-[13px] leading-relaxed text-ink-3">
        Fuentes: términos y cronograma de BYMA Educa (datos al {fmtDate(detail.asOf)}) con condiciones curadas por Warren; precios de data912 (precio sucio);
        TIR, duración, convexidad, paridad, tasa corriente, vida promedio y spread: {SRC_WARREN}. Informativo, no es una recomendación de inversión.
      </p>
    </div>
  )
}
