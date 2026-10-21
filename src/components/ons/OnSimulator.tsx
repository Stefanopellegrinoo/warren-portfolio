'use client'

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { simulateOn, type SimResult } from '@/lib/on-simulator'
import type { OnAnalysis } from '@/lib/on-analytics'
import { fmtDate, fmtNum, fmtPct, fmtVn, lineLabel, parseEsArNumber, plazaCopy, TAX_COPY } from '@/lib/on-format'
import { argentinaDate } from '@/lib/utils'

interface Props {
  analysis: OnAnalysis
  today?: string // ISO purchase date; defaults to today in Argentina
  initial?: { mode?: 'usd' | 'vn'; amount?: string; manualPrice?: string }
}

const usd = (x: number) => `USD ${fmtNum(x)}`
const MODES = [
  { id: 'usd', label: 'Monto en dólares (USD)' },
  { id: 'vn', label: 'Valor nominal (VN)' },
] as const

function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="kpi-card">
      <span className="text-[11px] font-mono uppercase tracking-widest text-slate-400">{label}</span>
      <span className="text-lg font-bold tracking-tight text-white">{children}</span>
      {hint && <span className="text-[11px] leading-tight text-slate-400">{hint}</span>}
    </div>
  )
}

const TH = 'px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-slate-400 whitespace-nowrap'
const TD = 'px-3 py-2 whitespace-nowrap'

function Result({ r, analysis }: { r: Extract<SimResult, { ok: true }>; analysis: OnAnalysis }) {
  const { row } = analysis
  const source = r.priceSource === 'manual' ? 'precio manual' : lineLabel(r.priceLine, row.cclUsed)
  const planned = r.plaza === 'CCL' ? 'cable' : r.plaza === 'MEP' ? 'MEP' : null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Comprás" hint={`Cantidad ${fmtNum(r.quantity, 2)} (VN ÷ 100). Liquidación T+1: ${fmtDate(r.settle)}`}>{fmtVn(r.vn)}</Stat>
        <Stat label="Costo" hint={r.leftover > 0.005 ? `Sobran ${usd(r.leftover)} del monto ingresado` : undefined}>{usd(r.cost)}</Stat>
        <Stat label="Precio sucio usado" hint={source}>{fmtNum(r.pricePct)}</Stat>
        <Stat label="Intereses devengados" hint={r.accruedUsd < 0 ? 'Negativo: comprás después de la fecha de registro' : 'Incluidos en el precio sucio'}>{usd(r.accruedUsd)}</Stat>
        <Stat label="Total cobrado" hint={`Intereses ${usd(r.totalInterest)} · capital ${usd(r.totalPrincipal)}`}>{usd(r.totalCollected)}</Stat>
        <Stat label="Ganancia vs. costo" hint={r.paybackDate ? `Recuperás lo invertido el ${fmtDate(r.paybackDate)}` : 'No se recupera lo invertido con los pagos'}>{usd(r.profit)}</Stat>
        <Stat label="TIR al precio de hoy" hint="Efectiva anual, hasta el vencimiento">{fmtPct(r.ytmPct)}</Stat>
        {r.ytw && (
          <Stat label="Rendimiento al peor (YTW)" hint={r.ytw.kind === 'call' ? `Hasta rescate el ${fmtDate(r.ytw.workoutDate)}. La TIR al vencimiento podría no darse: puede ser rescatado antes.` : `Hasta vencimiento el ${fmtDate(r.ytw.workoutDate)}. La ON tiene rescate anticipado; al precio actual el peor caso es el vencimiento.`}>{fmtPct(r.ytw.ytwPct)}</Stat>
        )}
      </div>

      {r.notes.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">
          {r.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}

      <div className="relative">
      <div tabIndex={0} role="region" aria-label="Pagos futuros de la tenencia simulada (desplazable)" className="overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber/50">
        <table className="w-full min-w-[640px] text-sm font-mono">
          <caption className="sr-only">Pagos futuros de la tenencia simulada, en dólares</caption>
          <thead>
            <tr className="border-b border-bg-600/60 text-right">
              <th scope="col" className={`${TH} text-left`}>Fecha</th>
              <th scope="col" className={`${TH} text-left`}>Fecha de pago</th>
              <th scope="col" className={TH}>Cupón</th>
              <th scope="col" className={TH}>Amortización</th>
              <th scope="col" className={TH}>Total</th>
              <th scope="col" className={TH}>Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {r.payments.map((p) => (
              <tr key={p.date} className="table-row text-right">
                <td className={`${TD} text-left`}>{fmtDate(p.date)}</td>
                <td className={`${TD} text-left`}>
                  {fmtDate(p.payDate)}
                  {p.payDate !== p.date && <span className="ml-1.5 text-[10px] text-slate-500" title="El pago se corre al siguiente día hábil">(día hábil)</span>}
                </td>
                <td className={TD}>
                  {fmtNum(p.interest)}
                  {p.exCoupon && <span className="ml-1.5 text-[10px] text-amber" title={`Cupón de ${usd(p.skippedInterest)} para quien vendió`}>no cobrás el cupón</span>}
                </td>
                <td className={TD}>{fmtNum(p.principal)}</td>
                <td className={TD}>{fmtNum(p.total)}</td>
                <td className={TD}>{fmtNum(p.cumulative)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Right-edge fade: the table scrolls horizontally on narrow screens. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-bg-800/90 to-transparent md:hidden" />
      </div>

      <div className="space-y-1 text-[11px] leading-relaxed text-slate-400">
        <p>{plazaCopy(r.plaza)}, sin importar la línea en la que comprás.</p>
        {r.priceLine === 'O' && row.cclUsed && <p>Precio implícito: línea O (pesos) ÷ CCL de ${fmtNum(row.cclUsed.rate)}.</p>}
        {r.lineFallback && r.priceLine !== 'O' && planned && <p>Atención: el precio es de la línea {r.priceLine}, pero la ON paga en dólar {planned}: el canje no está incluido en el precio ni en la TIR.</p>}
        {r.noTrades && <p>El precio es de referencia: la línea no operó en la rueda.</p>}
        <p className="font-bold">Sin impuestos ni reinversión. Sin comisiones ni tipo de cambio.</p>
        <p>{TAX_COPY}</p>
      </div>
    </div>
  )
}

const noSubscribe = () => () => {}
const FORMAT_ERROR = 'Formato de número inválido'

/** Single-ON payment simulator: everything is computed in the browser from the detail payload (no writes). */
export default function OnSimulator({ analysis, today, initial }: Props) {
  const [mode, setMode] = useState<'usd' | 'vn'>(initial?.mode ?? 'usd')
  const [amount, setAmount] = useState(initial?.amount ?? '1000')
  const [manual, setManual] = useState(initial?.manualPrice ?? '')
  // Computed after mount so server and client markup agree (the date is the browser's).
  const clientDay = useSyncExternalStore(noSubscribe, () => argentinaDate(), () => null)
  const day = today ?? clientDay

  const amountValue = parseEsArNumber(amount)
  const amountFormatError = amount.trim() !== '' && amountValue === null
  const manualValue = manual.trim() === '' ? null : parseEsArNumber(manual)
  const manualFormatError = manual.trim() !== '' && manualValue === null

  const result = useMemo(() => {
    if (day === null || amountFormatError || manualFormatError) return null
    return simulateOn({ analysis, mode, amount: amountValue ?? NaN, manualPrice: manualValue, today: day })
  }, [analysis, mode, amountValue, manualValue, amountFormatError, manualFormatError, day])
  const floating = analysis.row.rateType === 'floating'

  const error = amountFormatError || manualFormatError ? FORMAT_ERROR : result && !result.ok ? result.message : null
  const amountInvalid = amountFormatError || (result?.ok === false && (result.reason === 'bad-amount' || result.reason === 'below-min'))
  const priceInvalid = manualFormatError || (result?.ok === false && result.reason === 'bad-price')
  const summary = result?.ok ? `Comprás ${fmtVn(result.vn)}, costo ${usd(result.cost)}, TIR ${fmtPct(result.ytmPct)}` : null

  return (
    <section className="glass rounded-2xl p-5" aria-labelledby="sim-title">
      <h2 id="sim-title" className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-slate-300">Simulador de pagos</h2>
      {floating ? (
        <p className="text-sm text-slate-300">No simulable: tasa variable. Los cupones de una tasa variable no se proyectan.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
            <fieldset>
              <legend className="mb-1 text-[11px] font-mono uppercase tracking-widest text-slate-400">Ingresar</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {MODES.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-slate-200">
                    <input type="radio" name="sim-mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-1">
              <label htmlFor="sim-amount" className="text-[11px] font-mono uppercase tracking-widest text-slate-400">{mode === 'usd' ? 'Monto (USD)' : 'Valor nominal (VN)'}</label>
              <input id="sim-amount" className="input-field" type="text" inputMode="decimal" autoComplete="off" value={amount} aria-invalid={amountInvalid || undefined} aria-describedby={amountInvalid ? 'sim-status' : undefined} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="sim-price" className="text-[11px] font-mono uppercase tracking-widest text-slate-400">Precio manual (opcional, sucio por 100 VN)</label>
              <input id="sim-price" className="input-field" type="text" inputMode="decimal" autoComplete="off" placeholder={analysis.row.price !== null ? fmtNum(analysis.row.price) : 'Sin precio de mercado'} value={manual} aria-invalid={priceInvalid || undefined} aria-describedby={priceInvalid ? 'sim-status' : undefined} onChange={(e) => setManual(e.target.value)} />
            </div>
          </div>
          <p id="sim-status" aria-live="polite" className={error ? 'text-sm text-amber' : 'sr-only'}>{error ?? summary}</p>
          {result?.ok && <Result r={result} analysis={analysis} />}
        </div>
      )}
    </section>
  )
}
