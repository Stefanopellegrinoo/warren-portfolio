'use client'

import { useState, type ReactNode } from 'react'
import type { PortfolioAnalysis } from '@/lib/on-portfolio-analytics'
import { fmtDate, fmtMonth, fmtNum, fmtPct, TAX_COPY } from '@/lib/on-format'
import { SectionHead } from '@/components/resumen/ui'
import PortfolioCalendarChart from './PortfolioCalendarChart'
import { btnSecondary, HEAD_ROW, Metric, Metrics, notice, ScrollTable, signedUsd, signTone, TD, TH, TR } from '../ui'

const usd = (x: number) => `USD ${fmtNum(x)}`
const FIRST_MONTHS = 12
const PLAZA_LABEL = { MEP: 'Dólar MEP (cuenta local)', CCL: 'Dólar cable (exterior)', ARS: 'Pesos' } as const

function Stat({ label, hint, children, valueClass }: { label: string; hint?: ReactNode; children: ReactNode; valueClass?: string }) {
  return <Metric label={label} value={children} hint={hint} valueClass={valueClass} />
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="min-w-0" aria-labelledby={id}>
      <SectionHead id={id} title={title} />
      <div className="pt-4">{children}</div>
    </section>
  )
}

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

/** Same shape as the Resumen distribution: name, thin bar, percentage. */
function Bars({ rows, label }: { rows: { key: string; name: string; pct: number; detail: string }[]; label: string }) {
  return (
    <ul aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_96px_56px] items-center gap-x-3 gap-y-0.5 border-b border-line py-2.5 last:border-b-0 max-[819px]:grid-cols-[minmax(0,1fr)_auto]">
          <span className="min-w-0 truncate font-medium">{r.name}</span>
          <span className="relative h-1 overflow-hidden rounded-full bg-line max-[819px]:col-span-2 max-[819px]:row-start-2 max-[819px]:my-1" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(100, r.pct)}%` }} />
          </span>
          <span className="text-right text-[13px] tabular-nums text-ink-2 max-[819px]:col-start-2 max-[819px]:row-start-1">{fmtPct(r.pct, 1)}</span>
          <span className="col-span-3 text-[13px] text-ink-3 max-[819px]:col-span-2 max-[819px]:row-start-3">{r.detail}</span>
        </li>
      ))}
    </ul>
  )
}

/** `held`: the user's real current holdings (market value, next payment) instead of a hypothetical purchase (cost, profit). */
export default function PortfolioResults({ analysis: a, held = false }: { analysis: PortfolioAnalysis; held?: boolean }) {
  const [allMonths, setAllMonths] = useState(false)
  const months = allMonths ? a.monthly : a.monthly.slice(0, FIRST_MONTHS)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
      {a.warnings.length > 0 && (
        <section aria-labelledby="pf-warnings" className={notice('warn')}>
          <h2 id="pf-warnings" className="mb-1 font-semibold">Avisos ({a.warnings.length})</h2>
          <ul className="list-disc space-y-1 pl-5">{a.warnings.map((w, i) => <li key={`${w.isin}-${w.kind}-${i}`}>{w.message}</li>)}</ul>
        </section>
      )}

      {a.empty ? (
        <p className="py-4 text-ink-2">
          {a.skipped.length > 0 ? `Ninguna de las ONs se puede ${held ? 'proyectar' : 'simular'}: revisá los avisos.` : 'Agregá ONs para ver el calendario de cobros y las métricas de la cartera.'}
        </p>
      ) : (
        <>
          <Metrics>
            <Stat label={held ? 'Valor de mercado' : 'Costo total'} hint={held ? 'Cada ticker a su propia cotización (igual que el dashboard), solo ONs con precio' : 'Precio sucio: incluye los intereses devengados'}>{usd(a.totals.cost)}</Stat>
            <Stat label="Total a cobrar" hint={`Intereses ${usd(a.totals.interest)} · capital ${usd(a.totals.principal)}`}>{usd(a.totals.collected)}</Stat>
            {!held && <Stat label="Ganancia vs. costo" hint="Sin impuestos ni reinversión" valueClass={signTone(a.totals.profit)}>{signedUsd(a.totals.profit, fmtNum)}</Stat>}
            <Stat label="TIR de la cartera" hint={held ? 'TIR calculada con el precio de la línea de pago (cable/MEP). Flujos combinados, no un promedio de TIRs. Efectiva anual.' : 'Flujos combinados contra el costo total (no es un promedio de TIRs). Efectiva anual.'}>{fmtPct(a.ytmPct)}</Stat>
            <Stat label="Duración modificada" hint="Ponderada por valor de mercado">{a.mdYears === null ? '—' : `${fmtNum(a.mdYears)} años`}</Stat>
            <Stat label="Vida promedio" hint="Plazo medio de devolución del capital">{a.walYears === null ? '—' : `${fmtNum(a.walYears)} años`}</Stat>
            <Stat label="Intereses próximos 12 meses" hint={`Con capital: ${usd(a.next12m.total)}`}>{usd(a.next12m.interest)}</Stat>
            <Stat label="ONs en la cartera" hint={a.skipped.length > 0 ? `${a.skipped.length} sin simular` : undefined}>{a.positions.length}</Stat>
          </Metrics>

          <Section id="pf-calendar" title="Calendario de cobros">
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
            <p className="mt-3 text-[13px] text-ink-3">Los cobros se ubican en la fecha de pago ajustada al siguiente día hábil, que puede caer en otro mes que la fecha contractual.</p>
          </Section>

          <div className="grid grid-cols-2 gap-x-10 gap-y-10 max-[1080px]:grid-cols-1">
            <Section id="pf-annual" title="Ingreso por año calendario">
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
            </Section>
            <Section id="pf-ladder" title="Escalera de vencimientos">
              {a.ladder.length === 0 ? <p className="text-ink-3">Ninguna ON devuelve capital en el período.</p> : (
                <Bars label="Capital devuelto por año" rows={a.ladder.map((l) => ({ key: String(l.year), name: String(l.year), pct: l.pct, detail: `${usd(l.principal)} de capital` }))} />
              )}
            </Section>
            <Section id="pf-issuers" title="Concentración por emisor">
              <Bars label="Porcentaje del costo por emisor" rows={a.issuers.map((i) => ({ key: i.name, name: i.name, pct: i.pct, detail: usd(i.cost) }))} />
              <p className="mt-3 text-[13px] text-ink-3">Sobre el valor de mercado (costo sucio). El catálogo no trae el sector de cada emisor, por eso no se muestra esa vista.</p>
            </Section>
            <Section id="pf-plaza" title="Plaza de pago">
              <Bars label="Porcentaje del costo por plaza de pago" rows={a.plazas.map((p) => ({ key: String(p.plaza), name: p.plaza ? PLAZA_LABEL[p.plaza] : 'Plaza sin dato', pct: p.costPct, detail: `Cobrás ${usd(p.collected)} en total` }))} />
              <p className="mt-3 text-[13px] text-ink-3">La plaza es la de cobro de cada ON, sin importar la línea en la que se compra.</p>
            </Section>
          </div>

          <Section id="pf-positions" title="Detalle por ON">
            <Table caption="Detalle de cada ON de la cartera" minWidth={held ? 'min-w-[720px]' : 'min-w-[520px]'} head={held ? ['ON', 'VN', 'Valor de mercado', 'Peso', 'Próximo cobro', 'TIR', 'Duración'] : ['ON', 'VN', 'Costo', 'Peso', 'TIR', 'Duración']}>
              {a.positions.map((p) => (
                <tr key={p.isin} className={`${TR} text-right`}>
                  <td className={`${TD} text-left font-semibold`}>{p.ticker}</td>
                  <td className={TD}>{fmtNum(p.vn, 0)}</td>
                  <td className={TD}>{held && !p.priced ? '—' : fmtNum(p.cost)}</td>
                  <td className={TD}>{held && !p.priced ? '—' : fmtPct(p.weightPct, 1)}</td>
                  {held && <td className={TD}>{p.nextPayDate ? `${fmtDate(p.nextPayDate)} · ${usd(p.nextPayAmount ?? 0)}` : '—'}</td>}
                  <td className={TD}>{fmtPct(p.ytmPct)}</td>
                  <td className={TD}>{p.mdYears === null ? '—' : fmtNum(p.mdYears)}</td>
                </tr>
              ))}
            </Table>
          </Section>

          <p className="max-w-[96ch] text-[13px] leading-relaxed text-ink-3">
            {held ? 'Proyección de lo que cobrás con las ONs que tenés hoy, sin importar cuándo las compraste. ' : ''}Sin impuestos, comisiones ni reinversión; solo ONs en dólares de tasa fija, step up o cupón cero. Informativo, no es una recomendación de inversión. {TAX_COPY}
          </p>
        </>
      )}
    </div>
  )
}
