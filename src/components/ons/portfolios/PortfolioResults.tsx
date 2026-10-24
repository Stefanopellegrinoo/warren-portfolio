'use client'

import { useState, type ReactNode } from 'react'
import type { PortfolioAnalysis } from '@/lib/on-portfolio-analytics'
import { fmtMonth, fmtNum, fmtPct, TAX_COPY } from '@/lib/on-format'
import { SectionHead } from '@/components/resumen/ui'
import PortfolioCalendarChart from './PortfolioCalendarChart'
import { Bars, btnSecondary, Disclosure, HEAD_ROW, Metric, Metrics, ScrollTable, signedUsd, signTone, TD, TH, TR } from '../ui'

const usd = (x: number) => `USD ${fmtNum(x)}`
const FIRST_MONTHS = 12
const PLAZA_LABEL = { MEP: 'Dólar MEP (cuenta local)', CCL: 'Dólar cable (exterior)', ARS: 'Pesos' } as const
const NOTE = 'mt-3 text-[13px] text-ink-3'

function Table({ caption, head, children, minWidth = 'min-w-[440px]' }: { caption: string; head: string[]; children: ReactNode; minWidth?: string }) {
  return (
    <ScrollTable label={caption}>
      <table className={`w-full ${minWidth} border-collapse text-sm tabular-nums`}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className={`${HEAD_ROW} text-right`}>
            {head.map((h, i) => <th key={h} scope="col" className={`${TH} ${i === 0 ? 'text-left' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </ScrollTable>
  )
}

/**
 * odd/tasks/ux-ons-y-operaciones.md S5: the few numbers that answer "¿cuánto me pagaría esta combinación?".
 */
export function PortfolioSummary({ analysis: a }: { analysis: PortfolioAnalysis }) {
  return (
    <Metrics className="grid-cols-5">
      <Metric label="Costo total" value={usd(a.totals.cost)}
        hint="Lo que pagarías hoy, con los intereses ya corridos" />
      <Metric label="Total a cobrar" value={usd(a.totals.collected)} hint={`Intereses ${usd(a.totals.interest)} · capital ${usd(a.totals.principal)}`} />
      <Metric label="Ganancia vs. costo" value={signedUsd(a.totals.profit, fmtNum)} valueClass={signTone(a.totals.profit)} hint="Sin impuestos ni reinversión" />
      <Metric label="TIR de la cartera" value={fmtPct(a.ytmPct)}
        hint="Por año, todos los cobros juntos contra el costo (no es un promedio de TIRs)" />
      {a.next12m.total > 0 && <Metric label="Próximos 12 meses" value={usd(a.next12m.interest)}
        hint={a.next12m.principal > 0 ? `Intereses; con capital, ${usd(a.next12m.total)}` : 'Intereses que cobrarías en el próximo año'} />}
    </Metrics>
  )
}

/** The full analysis, each part a collapsed section with one line saying what is inside (S5). */
export function PortfolioDetails({ analysis: a }: { analysis: PortfolioAnalysis }) {
  const [allMonths, setAllMonths] = useState(false)
  const months = allMonths ? a.monthly : a.monthly.slice(0, FIRST_MONTHS)
  const top = a.issuers[0]
  return (
    <section aria-labelledby="pf-analysis" className="min-w-0">
      <SectionHead id="pf-analysis" title="Análisis completo" />
      <Disclosure id="pf-calendar" title="Calendario de cobros" summary={a.monthly.length > 0 ? `Cuánto cobrás cada mes, de ${fmtMonth(a.monthly[0].month)} a ${fmtMonth(a.monthly.at(-1)?.month)}` : 'Cuánto cobrás cada mes'}>
        <PortfolioCalendarChart months={a.monthly} />
        <div className="mt-4">
          <Table caption="Cobros por mes de la cartera, en dólares, por fecha de pago ajustada" head={['Mes', 'Intereses', 'Capital', 'Total', 'Acumulado']}>
            {months.map((m) => (
              <tr key={m.month} className={`${TR} text-right`}>
                <td className={`${TD} text-left`}>{fmtMonth(m.month)}</td>
                <td className={TD}>{fmtNum(m.interest)}</td>
                <td className={TD}>{fmtNum(m.principal)}</td>
                <td className={TD}>{fmtNum(m.total)}</td>
                <td className={TD}>{fmtNum(m.cumulative)}</td>
              </tr>
            ))}
          </Table>
        </div>
        {a.monthly.length > FIRST_MONTHS && (
          <button type="button" className={`${btnSecondary} mt-3 w-full`} aria-expanded={allMonths} onClick={() => setAllMonths((v) => !v)}>
            {allMonths ? `Mostrar solo los primeros ${FIRST_MONTHS} meses` : `Ver los ${a.monthly.length} meses`}
          </button>
        )}
        <p className={NOTE}>Los cobros se ubican en la fecha de pago ajustada al siguiente día hábil, que puede caer en otro mes que la fecha contractual.</p>
      </Disclosure>

      <Disclosure id="pf-annual" title="Ingreso por año" summary="Intereses y capital que cobrás cada año calendario">
        <Table caption="Ingreso anual de la cartera en dólares" head={['Año', 'Intereses', 'Capital', 'Total']}>
          {a.annual.map((y) => (
            <tr key={y.year} className={`${TR} text-right`}>
              <td className={`${TD} text-left`}>{y.year}</td>
              <td className={TD}>{fmtNum(y.interest)}</td>
              <td className={TD}>{fmtNum(y.principal)}</td>
              <td className={TD}>{fmtNum(y.total)}</td>
            </tr>
          ))}
        </Table>
      </Disclosure>

      <Disclosure id="pf-ladder" title="Escalera de vencimientos" summary="Cuánto capital te devuelven cada año">
        {a.ladder.length === 0 ? <p className="text-ink-3">Ninguna ON devuelve capital en el período.</p> : (
          <Bars label="Capital devuelto por año" rows={a.ladder.map((l) => ({ key: String(l.year), name: String(l.year), pct: l.pct, detail: `${usd(l.principal)} de capital` }))} />
        )}
      </Disclosure>

      <Disclosure id="pf-issuers" title="Concentración por emisor"
        summary={top ? `${a.issuers.length} ${a.issuers.length === 1 ? 'emisor' : 'emisores'}; el de más peso es ${top.name} (${fmtPct(top.pct, 1)})` : undefined}>
        <Bars label="Porcentaje del costo por emisor" rows={a.issuers.map((i) => ({ key: i.name, name: i.name, pct: i.pct, detail: usd(i.cost) }))} />
        <p className={NOTE}>Sobre el valor de mercado (costo sucio). El catálogo no trae el sector de cada emisor, por eso no se muestra esa vista.</p>
      </Disclosure>

      <Disclosure id="pf-plaza" title="Plaza de pago" summary="Dónde te pagan: dólar MEP o dólar cable">
        <Bars label="Porcentaje del costo por plaza de pago" rows={a.plazas.map((p) => ({ key: String(p.plaza), name: p.plaza ? PLAZA_LABEL[p.plaza] : 'Plaza sin dato', pct: p.costPct, detail: `Cobrás ${usd(p.collected)} en total` }))} />
        <p className={NOTE}>La plaza es la de cobro de cada ON, sin importar la línea en la que se compra.</p>
      </Disclosure>

      <Disclosure id="pf-positions" title="Detalle por ON" summary="Costo, peso, TIR y duración de cada ON">
        <Metrics className="mb-4 grid-cols-3">
          <Metric label="Duración modificada" value={a.mdYears === null ? '—' : `${fmtNum(a.mdYears)} años`} hint="De la cartera, ponderada por valor de mercado" />
          <Metric label="Vida promedio" value={a.walYears === null ? '—' : `${fmtNum(a.walYears)} años`} hint="Plazo medio de devolución del capital" />
          <Metric label="ONs en el cálculo" value={a.positions.length} hint={a.skipped.length > 0 ? `${a.skipped.length} sin simular` : undefined} />
        </Metrics>
        <Table caption="Detalle de cada ON de la cartera" minWidth="min-w-[520px]" head={['ON', 'VN', 'Costo', 'Peso', 'TIR', 'Duración']}>
          {a.positions.map((p) => (
            <tr key={p.isin} className={`${TR} text-right`}>
              {/* Same ticker as the explorer (the O line). */}
              <td className={`${TD} text-left font-semibold`}>{p.tickerO}</td>
              <td className={TD}>{fmtNum(p.vn, 0)}</td>
              <td className={TD}>{fmtNum(p.cost)}</td>
              <td className={TD}>{fmtPct(p.weightPct, 1)}</td>
              <td className={TD}>{fmtPct(p.ytmPct)}</td>
              <td className={TD}>{p.mdYears === null ? '—' : fmtNum(p.mdYears)}</td>
            </tr>
          ))}
        </Table>
      </Disclosure>

      <p className="mt-4 max-w-[96ch] text-[13px] leading-relaxed text-ink-3">
        Sin impuestos, comisiones ni reinversión; solo ONs en dólares de tasa fija, step up o cupón cero. Informativo, no es una recomendación de inversión. {TAX_COPY}
      </p>
    </section>
  )
}
