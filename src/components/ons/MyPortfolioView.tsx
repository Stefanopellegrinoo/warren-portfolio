'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { fmtDate, fmtMonth, fmtNum, fmtPct, TAX_COPY } from '@/lib/on-format'
import type { MyOnPortfolio } from '@/lib/on-my-portfolio'
import type { PortfolioAnalysis, PortfolioPayment } from '@/lib/on-portfolio-analytics'
import type { MissingGroup } from '@/lib/on-payments'
import { SectionHead } from '@/components/resumen/ui'
import PortfolioCalendarChart from './portfolios/PortfolioCalendarChart'
import { Bars, Disclosure, Glossary, HEAD_ROW, Metric, Metrics, notice, TD, TH, TR, btnSecondary } from './ui'

export type MyPortfolioData = MyOnPortfolio & { asOf: string | null; stale: boolean }

const usd = (x: number) => `USD ${fmtNum(x)}`
const NEXT_PAYMENTS = 6
const FIRST_MONTHS = 12
const PLAZA_LABEL = { MEP: 'Dólar MEP (cuenta local)', CCL: 'Dólar cable (exterior)', ARS: 'Pesos' } as const

const concept = (p: { interest: number; principal: number }) =>
  p.principal > 0 && p.interest > 0 ? 'Intereses y capital' : p.principal > 0 ? 'Capital' : 'Intereses'

/** "AAAAD", "AAAAD y BBBBD", "AAAAD, BBBBD y CCCCD". */
const joinNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`)

/** The first pay date and everything paid on it (payments arrive sorted by pay date). */
function nextPayment(payments: PortfolioPayment[]) {
  const first = payments[0]
  if (!first) return null
  const same = payments.filter((p) => p.payDate === first.payDate)
  return {
    date: first.payDate,
    total: same.reduce((s, p) => s + p.total, 0),
    tickers: Array.from(new Set(same.map((p) => p.ticker))),
    concept: concept({ interest: same.reduce((s, p) => s + p.interest, 0), principal: same.reduce((s, p) => s + p.principal, 0) }),
  }
}

/** S2: what the user opens the page for, before anything else. */
function Summary({ a }: { a: PortfolioAnalysis }) {
  const next = nextPayment(a.payments)
  return (
    <section aria-label="Resumen de tus ONs" className="grid gap-x-10 gap-y-5 border-b border-line pb-6 min-[820px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 className="text-[13px] text-ink-3">Próximo cobro</h2>
        {next ? (
          <>
            <p className="mt-1 text-[1.75rem] font-medium leading-tight tabular-nums">{fmtDate(next.date)}</p>
            <p className="mt-1 text-lg font-medium tabular-nums">{usd(next.total)}</p>
            <p className="mt-0.5 text-[13px] text-ink-2">{joinNames(next.tickers)} · {next.concept.toLowerCase()}</p>
          </>
        ) : <p className="mt-1 text-ink-2">No hay cobros por delante.</p>}
      </div>
      <div className="min-w-0">
        <h2 className="text-[13px] text-ink-3">Cobrás en los próximos 12 meses</h2>
        <p className="mt-1 text-xl font-medium tabular-nums">{usd(a.next12m.total)}</p>
        <p className="mt-0.5 text-[13px] text-ink-2 tabular-nums">Intereses {usd(a.next12m.interest)} · capital {usd(a.next12m.principal)}</p>
      </div>
      <div className="min-w-0">
        <h2 className="text-[13px] text-ink-3">Valor de mercado</h2>
        <p className="mt-1 text-xl font-medium tabular-nums">{usd(a.totals.cost)}</p>
        <p className="mt-0.5 text-[13px] text-ink-2 tabular-nums">{a.positions.length} {a.positions.length === 1 ? 'ON' : 'ONs'} · TIR {fmtPct(a.ytmPct)}</p>
      </div>
    </section>
  )
}

/** S2: the only thing on the page that asks the user to act, right after the summary. */
function MissingNotice({ missing }: { missing: MissingGroup[] }) {
  const list = missing.map((g) => `${g.ticker} (${g.payments.map((p) => fmtDate(p.date)).join(', ')})`)
  return (
    <p role="status" className={`${notice('warn')} flex flex-wrap items-center justify-between gap-x-4 gap-y-1`}>
      <span>Te faltan cargar pagos de {joinNames(list)}.</span>
      <a href="#mc-pagos" className="inline-flex min-h-6 items-center font-medium underline underline-offset-2 max-[819px]:min-h-11">Revisarlos</a>
    </p>
  )
}

function NextPayments({ payments }: { payments: PortfolioPayment[] }) {
  return (
    <section aria-labelledby="mc-proximos">
      <SectionHead id="mc-proximos" title="Próximos cobros" />
      <ul>
        {payments.slice(0, NEXT_PAYMENTS).map((p) => (
          <li key={`${p.isin}-${p.payDate}`} className="grid min-h-11 grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-line py-2 tabular-nums last:border-b-0 max-[400px]:grid-cols-[5.75rem_minmax(0,1fr)_auto] max-[400px]:gap-x-3">
            <span className="text-ink-2">{fmtDate(p.payDate)}</span>
            <span className="min-w-0 truncate"><span className="font-semibold">{p.ticker}</span> <span className="text-ink-3">· {concept(p)}</span></span>
            <span className="text-right font-medium">{usd(p.total)}</span>
          </li>
        ))}
      </ul>
      {payments.length > NEXT_PAYMENTS && (
        <p className="mt-2 text-[13px] text-ink-3">Hay {payments.length - NEXT_PAYMENTS} cobros más hasta el último vencimiento: están en el calendario de abajo.</p>
      )}
    </section>
  )
}

function Holdings({ a }: { a: PortfolioAnalysis }) {
  return (
    <section aria-labelledby="mc-ons">
      <SectionHead id="mc-ons" title="Tus ONs" count={a.positions.length} />
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_5rem_1rem] gap-x-4 border-b border-line py-2 text-[13px] text-ink-3 max-[819px]:hidden" aria-hidden="true">
        <span>ON</span><span className="text-right">Valor de mercado</span><span className="text-right">Próximo cobro</span><span className="text-right">TIR</span><span />
      </div>
      <ul>
        {a.positions.map((p) => (
          <li key={p.isin} className="border-b border-line last:border-b-0">
            <Link href={`/ons/${p.isin}`} className="grid min-h-11 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_5rem_1rem] items-center gap-x-4 py-2.5 tabular-nums hover:bg-hover max-[819px]:grid-cols-[minmax(0,1fr)_auto] max-[819px]:gap-y-0.5">
              <span className="min-w-0">
                <span className="font-semibold">{p.ticker}</span>
                <span className="block truncate text-[13px] text-ink-3">{p.issuer ?? 'Emisor sin dato'} · VN {fmtNum(p.vn, 0)}</span>
              </span>
              <span className="text-right">
                <span className="font-medium">{p.priced ? usd(p.cost) : 'Sin precio'}</span>
                {p.priced && <span className="block text-[13px] text-ink-3">{fmtPct(p.weightPct, 1)} de tus ONs</span>}
              </span>
              <span className="text-right max-[819px]:col-span-2 max-[819px]:text-left max-[819px]:text-[13px] max-[819px]:text-ink-2">
                <span className="min-[820px]:hidden">Próximo cobro </span>
                {p.nextPayDate ? <>{fmtDate(p.nextPayDate)}<span className="text-ink-3 max-[819px]:text-ink-2"> · {usd(p.nextPayAmount ?? 0)}</span></> : '—'}
                <span className="min-[820px]:hidden"> · TIR {fmtPct(p.ytmPct)}</span>
              </span>
              <span className="text-right max-[819px]:hidden">{fmtPct(p.ytmPct)}</span>
              <ChevronRight className="h-4 w-4 text-ink-3 max-[819px]:hidden" strokeWidth={1.5} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MonthTable({ a }: { a: PortfolioAnalysis }) {
  const [all, setAll] = useState(false)
  const months = all ? a.monthly : a.monthly.slice(0, FIRST_MONTHS)
  return (
    <>
      <table className="mt-4 w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">Cobros por mes, en dólares, por fecha de pago</caption>
        <thead>
          <tr className={`${HEAD_ROW} text-right`}>
            {['Mes', 'Intereses', 'Capital', 'Total'].map((h, i) => <th key={h} scope="col" className={`${TH} ${i === 0 ? 'text-left' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month} className={`${TR} text-right`}>
              <td className={`${TD} text-left`}>{fmtMonth(m.month)}</td>
              <td className={TD}>{fmtNum(m.interest)}</td>
              <td className={TD}>{fmtNum(m.principal)}</td>
              <td className={`${TD} font-medium`}>{fmtNum(m.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {a.monthly.length > FIRST_MONTHS && (
        <button type="button" className={`${btnSecondary} mt-3 w-full`} aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? `Mostrar solo los primeros ${FIRST_MONTHS} meses` : `Ver los ${a.monthly.length} meses`}
        </button>
      )}
      <p className="mt-3 text-[13px] text-ink-3">Cada cobro va en la fecha en que se paga: si cae en un feriado, el día hábil siguiente.</p>
    </>
  )
}

function Analysis({ a }: { a: PortfolioAnalysis }) {
  const sub = 'mb-2 mt-8 text-sm font-semibold first:mt-0'
  return (
    <>
      <Metrics className="mb-8">
        <Metric label="TIR de la cartera" value={fmtPct(a.ytmPct)} hint="Todos los cobros juntos contra el valor de mercado, no un promedio de TIRs" />
        <Metric label="Duración" value={a.mdYears === null ? '—' : `${fmtNum(a.mdYears)} años`} hint="Ponderada por valor de mercado" />
        <Metric label="Vida promedio" value={a.walYears === null ? '—' : `${fmtNum(a.walYears)} años`} hint="Plazo medio en que te devuelven el capital" />
        <Metric label="Total a cobrar" value={usd(a.totals.collected)} hint={`Intereses ${usd(a.totals.interest)} · capital ${usd(a.totals.principal)}`} />
      </Metrics>
      <div className="grid grid-cols-2 gap-x-10 max-[1080px]:grid-cols-1">
        <div className="min-w-0">
          <h3 className={sub}>Ingreso por año</h3>
          <table className="w-full border-collapse text-sm tabular-nums">
            <caption className="sr-only">Ingreso por año calendario, en dólares</caption>
            <thead>
              <tr className={`${HEAD_ROW} text-right`}>
                {['Año', 'Intereses', 'Capital', 'Total'].map((h, i) => <th key={h} scope="col" className={`${TH} ${i === 0 ? 'text-left' : ''}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {a.annual.map((y) => (
                <tr key={y.year} className={`${TR} text-right`}>
                  <td className={`${TD} text-left`}>{y.year}</td>
                  <td className={TD}>{fmtNum(y.interest)}</td>
                  <td className={TD}>{fmtNum(y.principal)}</td>
                  <td className={`${TD} font-medium`}>{fmtNum(y.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className={sub}>Cuándo te devuelven el capital</h3>
          {a.ladder.length === 0 ? <p className="text-ink-3">Ninguna ON devuelve capital en el período.</p> : (
            <Bars label="Capital devuelto por año" rows={a.ladder.map((l) => ({ key: String(l.year), name: String(l.year), pct: l.pct, detail: `${usd(l.principal)} de capital` }))} />
          )}
        </div>
        <div className="min-w-0">
          <h3 className={sub}>Por empresa</h3>
          <Bars label="Porcentaje del valor de mercado por empresa" rows={a.issuers.map((i) => ({ key: i.name, name: i.name, pct: i.pct, detail: usd(i.cost) }))} />
          <h3 className={sub}>Dónde cobrás</h3>
          <Bars label="Porcentaje del valor de mercado por plaza de pago" rows={a.plazas.map((p) => ({ key: String(p.plaza), name: p.plaza ? PLAZA_LABEL[p.plaza] : 'Plaza sin dato', pct: p.costPct, detail: `Cobrás ${usd(p.collected)} en total` }))} />
        </div>
      </div>
    </>
  )
}

export default function MyPortfolioView({ data, missing = [] }: { data: MyPortfolioData; missing?: MissingGroup[] }) {
  const { analysis: a, unmapped, stale } = data
  const nothing = a.empty && unmapped.length === 0 && a.skipped.length === 0
  if (nothing) {
    return (
      <p className="py-4 text-ink-2">
        No tenés ONs en cartera. Cuando cargues una compra, acá vas a ver cuándo y cuánto cobrás.{' '}
        <Link href="/ons" className="font-medium text-accent-ink underline underline-offset-2">Explorar ONs</Link>
      </p>
    )
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
      {stale && <p role="status" className={notice('warn')}>El catálogo de ONs no se actualizó hoy: los cobros y precios pueden estar desfasados.</p>}
      {a.empty ? (
        <p className="py-4 text-ink-2">{a.skipped.length > 0 ? 'Ninguna de tus ONs se puede proyectar: mirá los avisos de abajo.' : 'Todavía no hay cobros para mostrar.'}</p>
      ) : (
        <>
          <div className="grid gap-5">
            <Summary a={a} />
            {missing.length > 0 && <MissingNotice missing={missing} />}
          </div>
          <NextPayments payments={a.payments} />
          <Holdings a={a} />
          <div>
            <Disclosure id="mc-calendario" title="Calendario de cobros" summary="Mes por mes, cuánto entra de intereses y de capital">
              <PortfolioCalendarChart months={a.monthly} />
              <MonthTable a={a} />
            </Disclosure>
            <Disclosure id="mc-analisis" title="Análisis de la cartera" summary="TIR, duración, cuándo vuelve el capital y cuánto tenés por empresa">
              <Analysis a={a} />
            </Disclosure>
          </div>
        </>
      )}
      {a.warnings.length > 0 && (
        <Disclosure title="Avisos sobre el cálculo" count={a.warnings.length} summary="Datos que faltan o que se estimaron">
          <ul className="list-disc space-y-1 pl-5 text-ink-2">{a.warnings.map((w, i) => <li key={`${w.isin}-${w.kind}-${i}`}>{w.message}</li>)}</ul>
        </Disclosure>
      )}
      {unmapped.length > 0 && (
        <section aria-labelledby="mc-unmapped">
          <SectionHead id="mc-unmapped" title="Sin términos en el catálogo" count={unmapped.length} />
          <ul>
            {unmapped.map((u) => (
              <li key={u.ticker} className="flex min-h-11 items-center justify-between gap-3 border-b border-line py-2 tabular-nums last:border-b-0">
                <span className="font-semibold">{u.ticker}</span><span className="text-ink-2">VN {fmtNum(u.vn, 0)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-ink-3">Estas posiciones no se encontraron en el catálogo (vencidas, en pesos o con otro ticker), por eso no entran en la proyección.</p>
        </section>
      )}
    </div>
  )
}

/** The fine print and the glossary, once, at the end of the page (after the paid payments). */
export function MyPortfolioFooter() {
  return (
    <div className="grid gap-6">
      <p className="max-w-[96ch] text-[13px] leading-relaxed text-ink-3">
        Proyección de lo que cobrás con las ONs que tenés hoy, sin impuestos, comisiones ni reinversión; solo ONs en dólares de tasa fija, step up o cupón cero. Informativo, no es una recomendación de inversión. {TAX_COPY}
      </p>
      <Glossary terms={['TIR', 'Duración', 'Vida promedio', 'Valor nominal (VN)', 'Cupón', 'Amortización', 'Plaza de pago']} />
    </div>
  )
}
