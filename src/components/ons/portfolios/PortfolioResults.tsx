'use client'

import { useState, type ReactNode } from 'react'
import type { PortfolioAnalysis } from '@/lib/on-portfolio-analytics'
import { fmtDate, fmtMonth, fmtNum, fmtPct, TAX_COPY } from '@/lib/on-format'
import PortfolioCalendarChart from './PortfolioCalendarChart'

const usd = (x: number) => `USD ${fmtNum(x)}`
const TH = 'px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-slate-400 whitespace-nowrap'
const TD = 'px-3 py-2 whitespace-nowrap'
const FIRST_MONTHS = 12
const PLAZA_LABEL = { MEP: 'Dólar MEP (cuenta local)', CCL: 'Dólar cable (exterior)', ARS: 'Pesos' } as const

function Stat({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="kpi-card">
      <span className="text-[11px] font-mono uppercase tracking-widest text-slate-400">{label}</span>
      <span className="text-lg font-bold tracking-tight text-white">{children}</span>
      {hint && <span className="text-[11px] leading-tight text-slate-400">{hint}</span>}
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="glass min-w-0 rounded-2xl p-5" aria-labelledby={id}>
      <h2 id={id} className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-slate-300">{title}</h2>
      {children}
    </section>
  )
}

function Table({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) {
  return (
    <div tabIndex={0} role="region" aria-label={`${caption} (desplazable)`} className="overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber/50">
      <table className="w-full min-w-[480px] text-sm font-mono">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-bg-600/60 text-right">
            {head.map((h, i) => <th key={h} scope="col" className={`${TH} ${i === 0 ? 'text-left' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Bars({ rows, label }: { rows: { key: string; name: string; pct: number; detail: string }[]; label: string }) {
  return (
    <ul className="space-y-3" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-slate-200">{r.name}</span>
            <span className="shrink-0 font-mono text-white">{fmtPct(r.pct, 1)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-bg-600/60" aria-hidden><div className="h-full rounded-full bg-amber" style={{ width: `${Math.min(100, r.pct)}%` }} /></div>
          <p className="mt-0.5 text-[11px] text-slate-400">{r.detail}</p>
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
    <div className="space-y-5">
      {a.warnings.length > 0 && (
        <section aria-labelledby="pf-warnings" className="rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">
          <h2 id="pf-warnings" className="mb-1 font-bold">Avisos ({a.warnings.length})</h2>
          <ul className="list-disc space-y-1 pl-5">{a.warnings.map((w, i) => <li key={`${w.isin}-${w.kind}-${i}`}>{w.message}</li>)}</ul>
        </section>
      )}

      {a.empty ? (
        <div className="glass rounded-2xl p-6 text-sm text-slate-300">
          {a.skipped.length > 0 ? `Ninguna de las ONs se puede ${held ? 'proyectar' : 'simular'}: revisá los avisos.` : 'Agregá ONs para ver el calendario de cobros y las métricas de la cartera.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={held ? 'Valor de mercado' : 'Costo total'} hint={held ? 'Al precio actual (sucio), solo ONs con precio' : 'Precio sucio: incluye los intereses devengados'}>{usd(a.totals.cost)}</Stat>
            <Stat label="Total a cobrar" hint={`Intereses ${usd(a.totals.interest)} · capital ${usd(a.totals.principal)}`}>{usd(a.totals.collected)}</Stat>
            {!held && <Stat label="Ganancia vs. costo" hint="Sin impuestos ni reinversión">{usd(a.totals.profit)}</Stat>}
            <Stat label="TIR de la cartera" hint={`Flujos combinados contra ${held ? 'el valor de mercado' : 'el costo total'} (no es un promedio de TIRs). Efectiva anual.`}>{fmtPct(a.ytmPct)}</Stat>
            <Stat label="Duración modificada" hint="Ponderada por valor de mercado">{a.mdYears === null ? '—' : `${fmtNum(a.mdYears)} años`}</Stat>
            <Stat label="Vida promedio" hint="Plazo medio de devolución del capital">{a.walYears === null ? '—' : `${fmtNum(a.walYears)} años`}</Stat>
            <Stat label="Intereses próximos 12 meses" hint={`Con capital: ${usd(a.next12m.total)}`}>{usd(a.next12m.interest)}</Stat>
            <Stat label="ONs en la cartera" hint={a.skipped.length > 0 ? `${a.skipped.length} sin simular` : undefined}>{a.positions.length}</Stat>
          </div>

          <Section id="pf-calendar" title="Calendario de cobros">
            <PortfolioCalendarChart months={a.monthly} />
            <div className="mt-4">
              <Table caption="Cobros por mes de la cartera, en dólares, por fecha de pago ajustada" head={['Mes', 'Intereses', 'Capital', 'Total', 'Acumulado']}>
                {months.map((m) => (
                  <tr key={m.month} className="table-row text-right">
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
              <button type="button" className="btn-ghost mt-3 w-full" aria-expanded={allMonths} onClick={() => setAllMonths((v) => !v)}>
                {allMonths ? `Mostrar solo los primeros ${FIRST_MONTHS} meses` : `Ver los ${a.monthly.length} meses`}
              </button>
            )}
            <p className="mt-3 text-[11px] text-slate-400">Los cobros se ubican en la fecha de pago ajustada al siguiente día hábil, que puede caer en otro mes que la fecha contractual.</p>
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section id="pf-annual" title="Ingreso por año calendario">
              <Table caption="Ingreso anual de la cartera en dólares" head={['Año', 'Intereses', 'Capital', 'Total']}>
                {a.annual.map((y) => (
                  <tr key={y.year} className="table-row text-right">
                    <td className={`${TD} text-left`}>{y.year}</td>
                    <td className={TD}>{fmtNum(y.interest)}</td>
                    <td className={TD}>{fmtNum(y.principal)}</td>
                    <td className={TD}>{fmtNum(y.total)}</td>
                  </tr>
                ))}
              </Table>
            </Section>
            <Section id="pf-ladder" title="Escalera de vencimientos">
              {a.ladder.length === 0 ? <p className="text-sm text-slate-400">Ninguna ON devuelve capital en el período.</p> : (
                <Bars label="Capital devuelto por año" rows={a.ladder.map((l) => ({ key: String(l.year), name: String(l.year), pct: l.pct, detail: `${usd(l.principal)} de capital` }))} />
              )}
            </Section>
            <Section id="pf-issuers" title="Concentración por emisor">
              <Bars label="Porcentaje del costo por emisor" rows={a.issuers.map((i) => ({ key: i.name, name: i.name, pct: i.pct, detail: usd(i.cost) }))} />
              <p className="mt-3 text-[11px] text-slate-400">Sobre el valor de mercado (costo sucio). El catálogo no trae el sector de cada emisor, por eso no se muestra esa vista.</p>
            </Section>
            <Section id="pf-plaza" title="Plaza de pago">
              <Bars label="Porcentaje del costo por plaza de pago" rows={a.plazas.map((p) => ({ key: String(p.plaza), name: p.plaza ? PLAZA_LABEL[p.plaza] : 'Plaza sin dato', pct: p.costPct, detail: `Cobrás ${usd(p.collected)} en total` }))} />
              <p className="mt-3 text-[11px] text-slate-400">La plaza es la de cobro de cada ON, sin importar la línea en la que se compra.</p>
            </Section>
          </div>

          <Section id="pf-positions" title="Detalle por ON">
            <Table caption="Detalle de cada ON de la cartera" head={held ? ['ON', 'VN', 'Valor de mercado', 'Peso', 'Próximo cobro', 'TIR', 'Duración'] : ['ON', 'VN', 'Costo', 'Peso', 'TIR', 'Duración']}>
              {a.positions.map((p) => (
                <tr key={p.isin} className="table-row text-right">
                  <td className={`${TD} text-left`}>{p.ticker}</td>
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

          <p className="text-[11px] leading-relaxed text-slate-400">
            {held ? 'Proyección de lo que cobrás con las ONs que tenés hoy, sin importar cuándo las compraste. ' : ''}Sin impuestos, comisiones ni reinversión; solo ONs en dólares de tasa fija, step up o cupón cero. Informativo, no es una recomendación de inversión. {TAX_COPY}
          </p>
        </>
      )}
    </div>
  )
}
