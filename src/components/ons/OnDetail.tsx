import Link from 'next/link'
import type { ReactNode } from 'react'
import OnPriceChart from './OnPriceChart'
import OnSchedule from './OnSchedule'
import OnSourceChip from './OnSourceChip'
import type { OnAnalysis } from '@/lib/on-analytics'
import type { PricePoint } from '@/lib/on-catalog'
import type { F } from '@/lib/on-terms'
import { lineLabel, eventLabel, fmtBp, fmtDate, fmtNum, fmtPct, fmtVn, plazaCopy, rateTypeLabel, safeHref } from '@/lib/on-format'
import { formatAge } from '@/lib/utils'

interface Props {
  analysis: OnAnalysis
  history: PricePoint[]
  asOf: string | null
  stale: boolean
  prices: { ok: boolean; quiet?: boolean; fetchedAt: string | null }
}

const SRC_WARREN = 'Warren (cálculo propio)'
const BDC_LABEL = { following: 'Siguiente día hábil', modified_following: 'Siguiente día hábil modificado', preceding: 'Día hábil anterior' }
const TAX_COPY = 'ONs de oferta pública: exentas de Ganancias para personas humanas, art. 36 Ley 23.576; consultá a tu contador. Warren no calcula impuestos.'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-slate-300">{title}</h2>
      {children}
    </section>
  )
}

function Tile({ label, value, source, children }: { label: string; value: string; source: string; children?: ReactNode }) {
  return (
    <div className="kpi-card">
      <span className="text-[11px] font-mono uppercase tracking-widest text-slate-400">{label}</span>
      <span className="text-xl font-bold tracking-tight text-white">{value}</span>
      {children}
      <span className="text-[10px] font-mono text-slate-500">{source}</span>
    </div>
  )
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-bg-600/40 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-56 shrink-0 text-[11px] font-mono uppercase tracking-widest text-slate-500">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-sm text-slate-200">{children}</dd>
    </div>
  )
}

const chip = <T,>(f: F<T>) => <OnSourceChip prov={f.prov} sourceUrl={f.sourceUrl} verifiedAt={f.verifiedAt} />

function Banner({ children }: { children: ReactNode }) {
  return <div role="status" className="rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">{children}</div>
}

export default function OnDetail({ analysis, history, asOf, stale, prices }: Props) {
  const { row, detail } = analysis
  const t = detail.terms
  const priced = row.status === 'ok'
  const floating = row.rateType === 'floating'
  const flag = row.methodFlag
  const note = row.termsNote
  const lot = (f: F<number | null>, unknown: string) => (f.value === null ? <span className="text-slate-400">{unknown}</span> : <span>{fmtVn(f.value)}</span>)

  return (
    <div className="space-y-5">
      <Link href="/ons" className="inline-block text-sm text-slate-400 hover:text-white">← Volver al listado</Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">{row.tickerO}</h1>
          <span className="rounded-full border border-slate-500/30 px-2 py-0.5 text-[11px] font-mono text-slate-300">{row.currencyLabel} · Ley {row.law === 'ARG' ? 'argentina' : 'Nueva York'}</span>
          <span className="rounded-full border border-slate-500/30 px-2 py-0.5 text-[11px] font-mono text-slate-300">{rateTypeLabel(row.rateType)}</span>
          {floating && <span title="Tasa variable: no se proyectan los cupones, por eso no se calcula TIR ni se puede simular" className="cursor-help rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[11px] font-mono text-slate-400">No simulable</span>}
          {row.events.map((e) => {
            const href = safeHref(e.sourceUrl)
            const text = `${eventLabel(e.kind)} ${fmtDate(e.eventDate)}`
            const cls = 'rounded-full border border-sky/30 bg-sky/10 px-2 py-0.5 text-[11px] font-mono text-sky'
            return href ? <a key={`${e.kind}-${e.eventDate}`} href={href} target="_blank" rel="noopener noreferrer" title={e.note ?? undefined} className={cls}>{text}</a> : <span key={`${e.kind}-${e.eventDate}`} className={cls}>{text}</span>
          })}
        </div>
        <p className="text-sm text-slate-400">{row.issuer ?? 'Emisor sin dato'}{row.description ? ` · ${row.description}` : ''} · <span className="font-mono">{row.isin}</span></p>
      </header>

      {stale && <Banner>Catálogo desactualizado: los datos de BYMA Educa son del {fmtDate(asOf)}.</Banner>}
      {prices.ok && prices.quiet && <Banner>Mercado sin operaciones aún hoy: se muestran los precios de la última rueda.</Banner>}
      {!prices.ok && <Banner>Precios no disponibles en este momento (data912): no se calculan TIR ni duración.</Banner>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {priced ? (
          <>
            <Tile label="Precio sucio" value={fmtNum(row.price)} source={`data912, ${lineLabel(row.priceLine, row.cclUsed)}${prices.fetchedAt ? ` · ${formatAge(prices.fetchedAt)}` : ''}`}>
              {row.priceLine === 'O' && row.cclUsed && (
                <span className="text-[11px] leading-tight text-slate-400">
                  Precio implícito: línea O (pesos) ÷ CCL de ${fmtNum(row.cclUsed.rate)} (consultado el {fmtDate(row.cclUsed.asOf.slice(0, 10))}), igual que BYMA.
                </span>
              )}
              {row.lineFallback && row.priceLine !== 'O' && (
                <span className="text-[11px] leading-tight text-slate-400">
                  Atención: precio de la línea {row.priceLine}; esta ON paga en dólar {row.plaza === 'CCL' ? 'cable' : 'MEP'}: la TIR no incluye el canje.
                </span>
              )}
            </Tile>
            <Tile label="Precio limpio" value={fmtNum(detail.clean)} source={SRC_WARREN} />
            <Tile label="Intereses devengados" value={fmtNum(detail.accrued, 4)} source={SRC_WARREN} />
            <Tile label="Paridad" value={fmtPct(row.paridadPct)} source={SRC_WARREN} />
            <Tile label={row.priceLine === 'O' ? 'TIR Warren (precio en dólares, implícito O ÷ CCL)' : `TIR Warren (precio en dólares, línea ${row.priceLine})`} value={fmtPct(row.ytmPct)} source={SRC_WARREN}>
              {row.priceQuality === 'no-trades' && <span className="text-[11px] text-slate-400">Atención: precio de referencia sin operaciones en la línea D en la rueda; la TIR puede no ser representativa.</span>}
              {row.shortDated && <span className="text-[10px] text-slate-400">Vence en menos de 90 días: la TIR es muy sensible al precio y poco representativa.</span>}
              {flag && (
                <span className="rounded-md border border-amber/30 bg-amber/10 px-1.5 py-1 text-[11px] leading-tight text-amber">
                  Cálculo no verificado: difiere de BYMA (BYMA {fmtPct(flag.bymaYtmPct)} · Warren {fmtPct(flag.methodYtmPct)}, {fmtBp(flag.diffBp)}, control del {fmtDate(flag.asOf)}). Ninguno es definitivo.
                </span>
              )}
              {!flag && note && (
                <span className="text-[11px] leading-tight text-slate-400">
                  Con los términos de Warren la TIR es {fmtPct(note.termsYtmPct)}; BYMA informa {fmtPct(note.bymaYtmPct)} ({fmtBp(note.diffBp)}): difiere de BYMA por convención de intereses. Es informativo.
                </span>
              )}
            </Tile>
            {row.bymaYtm && (
              <Tile label="TIR BYMA (precio en pesos ÷ MEP)" value={fmtPct(row.bymaYtm.pct)} source={`BYMA Educa · ${fmtDate(row.bymaYtm.asOf)}`}>
                <span className="text-[11px] leading-tight text-slate-400">Ambas TIR son válidas y pueden diferir porque parten de precios distintos: la de BYMA usa el precio en pesos dividido por el MEP; la de Warren, el precio en dólares de la línea D.</span>
              </Tile>
            )}
            {detail.ytw && (
              <Tile
                label="Rendimiento al peor (YTW)"
                value={fmtPct(detail.ytw.ytwPct)}
                source={SRC_WARREN}
              >
                <span className="text-[11px] text-slate-400">{detail.ytw.kind === 'call' ? `Hasta rescate el ${fmtDate(detail.ytw.workoutDate)}` : `Hasta vencimiento el ${fmtDate(detail.ytw.workoutDate)}`}</span>
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
          <div className="kpi-card col-span-2 lg:col-span-4">
            <span className="text-[11px] font-mono uppercase tracking-widest text-slate-400">Precio y rendimiento</span>
            <span className="text-xl font-bold text-slate-300">{floating ? '—' : 'Sin precio'}</span>
            <span className="text-xs text-slate-400">
              {floating ? 'Tasa variable: no se calcula TIR ni duración.' : row.currency !== 'USD' ? 'Esta ON no cotiza en dólares: no se calcula TIR con un precio en otra moneda.' : 'No hay cotización de la línea D (dólar MEP): no se calculan TIR, duración ni paridad. Los términos y el cronograma siguen disponibles.'}
            </span>
          </div>
        )}
        <Tile label="Próximo pago" value={row.nextPayDate ? fmtDate(row.nextPayDate) : '—'} source={row.nextPayAmountPct !== null ? `${fmtNum(row.nextPayAmountPct, 4)}% del VN original · fecha ajustada por día hábil` : 'Sin pagos futuros'} />
      </div>

      <Section title="Historial de precio">
        <p className="mb-2 text-[11px] font-mono text-slate-500">Precio sucio de la línea D · data912</p>
        <OnPriceChart history={history} ticker={row.tickerD} />
      </Section>

      <Section title="Cronograma de pagos">
        <OnSchedule schedule={detail.schedule} floating={floating} />
      </Section>

      <Section title="Condiciones de emisión">
        <dl>
          <Term label="Emisor">{row.issuer ?? 'sin dato'}{row.description ? ` · ${row.description}` : ''}</Term>
          <Term label="Tickers">{[row.tickerO, row.tickerD, detail.tickerC].filter(Boolean).join(' · ')}</Term>
          <Term label="Plaza de pago"><span>{plazaCopy(t.paymentPlaza.value)}</span>{chip(t.paymentPlaza)}</Term>
          <Term label="Monto emitido">
            {t.issuedAmount.value === null ? <span className="text-slate-400">sin dato</span> : <span>{fmtVn(t.issuedAmount.value)}</span>}
            {t.issuedAmount.prov !== 'byma' && t.issuedAmount.value !== null && chip(t.issuedAmount)}
            {t.issuedAmountByma !== null && (t.issuedAmount.prov === 'byma' || t.issuedAmount.value !== t.issuedAmountByma) && (
              <span className="text-[11px] text-slate-500">{fmtVn(t.issuedAmountByma)} según BYMA, puede estar desactualizado</span>
            )}
          </Term>
          <Term label="Emisión / vencimiento">{fmtDate(detail.issueDate)} → {fmtDate(row.maturityDate)}</Term>
          <Term label="Cupón">{detail.couponRatePct === null ? 'Sin cupón' : `${fmtPct(detail.couponRatePct, 4)} anual`}{detail.frequency ? ` · ${detail.frequency}` : ''}</Term>
          <Term label="Base de cálculo"><span>{t.dayCount.value}</span>{chip(t.dayCount)}</Term>
          <Term label="Día hábil (pagos)"><span>{BDC_LABEL[t.bdc.value]}</span>{chip(t.bdc)}</Term>
          <Term label="Día hábil (vencimiento)"><span>{BDC_LABEL[t.maturityBdc.value]}</span>{chip(t.maturityBdc)}</Term>
          <Term label="Fecha de registro">
            {t.recordOffsetDays.value === null ? <span className="text-slate-400">sin fecha de registro cargada</span> : <span>{t.recordOffsetDays.value} días corridos antes del pago</span>}
            {chip(t.recordOffsetDays)}
          </Term>
          <Term label="Lámina mínima (VN)">{lot(t.minDenomination, 'lámina mínima desconocida')}{chip(t.minDenomination)}</Term>
          <Term label="Unidad mínima de negociación">{lot(t.minTradeUnit, 'sin dato')}{chip(t.minTradeUnit)}</Term>
          <Term label="Múltiplo (incremento)">{lot(t.increment, 'sin dato')}{chip(t.increment)}</Term>
        </dl>
      </Section>

      <Section title="Opciones de rescate y venta">
        <div className="space-y-2 text-sm text-slate-200">
          {t.calls.value.length === 0 ? (
            <p className="flex flex-wrap items-center gap-2"><span className="text-slate-400">Sin opciones de rescate registradas</span>{chip(t.calls)}</p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2"><span>Rescate anticipado del emisor</span>{chip(t.calls)}</p>
              <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
                {t.calls.value.map((c) => (
                  <li key={c.from}>Desde {fmtDate(c.from)}{c.to ? ` hasta ${fmtDate(c.to)}` : ' sin fecha límite'}: {fmtPct(c.pricePct)} del valor residual</li>
                ))}
              </ul>
            </>
          )}
          {t.puts.value.length > 0 && (
            <>
              <p className="flex flex-wrap items-center gap-2"><span>Opciones de venta del inversor</span>{chip(t.puts)}</p>
              <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
                {t.puts.value.map((p, i) => (
                  <li key={`${p.kind}-${i}`}>
                    {p.kind === 'change_of_control' ? 'Por cambio de control' : p.kind}: {fmtPct(p.pricePct)}{p.note ? ` · ${p.note}` : ''}
                    {p.kind === 'change_of_control' && ' (contingente: solo informativo, no entra en la TIR)'}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-[11px] text-slate-500">El rendimiento al peor considera solo rescates con fecha cierta; las opciones contingentes no se incluyen.</p>
        </div>
      </Section>

      {detail.warnings.length > 0 && (
        <Banner>Hay datos curados que no se pudieron leer ({detail.warnings.map((w) => w.field).join(', ')}) y se usaron los valores por defecto.</Banner>
      )}

      <Section title="Impuestos">
        <p className="text-sm text-slate-300">{TAX_COPY}</p>
      </Section>

      <p className="text-[11px] font-mono leading-relaxed text-slate-500">
        Fuentes: términos y cronograma de BYMA Educa (datos al {fmtDate(detail.asOf)}) con condiciones curadas por Warren; precios de data912 (precio sucio);
        TIR, duración, convexidad, paridad, tasa corriente, vida promedio y spread: {SRC_WARREN}. Informativo, no es una recomendación de inversión.
      </p>
    </div>
  )
}
