'use client'

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { simulateOn, type SimResult } from '@/lib/on-simulator'
import type { OnAnalysis } from '@/lib/on-analytics'
import { fmtDate, fmtNum, fmtPct, fmtVn, lineLabel, parseEsArNumber, plazaCopy, TAX_COPY } from '@/lib/on-format'
import { argentinaDate, cn } from '@/lib/utils'
import { SectionHead } from '@/components/resumen/ui'
import { field, HEAD_ROW, hint as hintCls, label as labelCls, Metric, Metrics, notice, ScrollTable, signedUsd, signTone, TD as TD_BASE, TH as TH_BASE, TR } from './ui'

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

function Stat({ label, children, hint, valueClass }: { label: string; children: ReactNode; hint?: ReactNode; valueClass?: string }) {
  return <Metric label={label} value={children} hint={hint} valueClass={valueClass} />
}

const TH = TH_BASE
const TD = TD_BASE

function Result({ r, analysis }: { r: Extract<SimResult, { ok: true }>; analysis: OnAnalysis }) {
  const { row } = analysis
  const source = r.priceSource === 'manual' ? 'precio manual' : lineLabel(r.priceLine, row.cclUsed)
  const planned = r.plaza === 'CCL' ? 'cable' : r.plaza === 'MEP' ? 'MEP' : null
  return (
    <div className="grid gap-5">
      <Metrics>
        <Stat label="Comprás" hint={`Cantidad ${fmtNum(r.quantity, 2)} (VN ÷ 100). Liquidación T+1: ${fmtDate(r.settle)}`}>{fmtVn(r.vn)}</Stat>
        <Stat label="Costo" hint={r.leftover > 0.005 ? `Sobran ${usd(r.leftover)} del monto ingresado` : undefined}>{usd(r.cost)}</Stat>
        <Stat label="Precio sucio usado" hint={source}>{fmtNum(r.pricePct)}</Stat>
        <Stat label="Intereses devengados" hint={r.accruedUsd < 0 ? 'Negativo: comprás después de la fecha de registro' : 'Incluidos en el precio sucio'}>{usd(r.accruedUsd)}</Stat>
        <Stat label="Total cobrado" hint={`Intereses ${usd(r.totalInterest)} · capital ${usd(r.totalPrincipal)}`}>{usd(r.totalCollected)}</Stat>
        <Stat label="Ganancia vs. costo" valueClass={signTone(r.profit)} hint={r.paybackDate ? `Recuperás lo invertido el ${fmtDate(r.paybackDate)}` : 'No se recupera lo invertido con los pagos'}>{signedUsd(r.profit, fmtNum)}</Stat>
        <Stat label="TIR al precio de hoy" hint="Efectiva anual, hasta el vencimiento">{fmtPct(r.ytmPct)}</Stat>
        {r.ytw && (
          <Stat label="Rendimiento al peor (YTW)" hint={r.ytw.kind === 'call' ? `Hasta rescate el ${fmtDate(r.ytw.workoutDate)}. La TIR al vencimiento podría no darse: puede ser rescatado antes.` : `Hasta vencimiento el ${fmtDate(r.ytw.workoutDate)}. La ON tiene rescate anticipado; al precio actual el peor caso es el vencimiento.`}>{fmtPct(r.ytw.ytwPct)}</Stat>
        )}
      </Metrics>

      {r.notes.length > 0 && (
        <ul className={cn(notice('warn'), 'space-y-1')}>
          {r.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}

      <ScrollTable label="Pagos futuros de la tenencia simulada">
        <table className="w-full min-w-[600px] border-collapse text-sm tabular-nums">
          <caption className="sr-only">Pagos futuros de la tenencia simulada, en dólares</caption>
          <thead>
            <tr className={`${HEAD_ROW} text-right`}>
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
              <tr key={p.date} className={`${TR} text-right`}>
                <td className={`${TD} text-left`}>{fmtDate(p.date)}</td>
                <td className={`${TD} text-left`}>
                  {fmtDate(p.payDate)}
                  {p.payDate !== p.date && <span className="ml-1.5 text-xs text-ink-3" title="El pago se corre al siguiente día hábil">(día hábil)</span>}
                </td>
                <td className={TD}>
                  {fmtNum(p.interest)}
                  {p.exCoupon && <span className="ml-1.5 text-xs text-warn" title={`Cupón de ${usd(p.skippedInterest)} para quien vendió`}>no cobrás el cupón</span>}
                </td>
                <td className={TD}>{fmtNum(p.principal)}</td>
                <td className={TD}>{fmtNum(p.total)}</td>
                <td className={TD}>{fmtNum(p.cumulative)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>

      <div className="max-w-[96ch] space-y-1 text-[13px] leading-relaxed text-ink-3">
        <p>{plazaCopy(r.plaza)}, sin importar la línea en la que comprás.</p>
        {r.priceLine === 'O' && row.cclUsed && <p>Precio implícito: línea O (pesos) ÷ CCL de ${fmtNum(row.cclUsed.rate)}.</p>}
        {r.lineFallback && r.priceLine !== 'O' && planned && <p>Atención: el precio es de la línea {r.priceLine}, pero la ON paga en dólar {planned}: el canje no está incluido en el precio ni en la TIR.</p>}
        {r.noTrades && <p>El precio es de referencia: la línea no operó en la rueda.</p>}
        <p className="font-medium text-ink-2">Sin impuestos ni reinversión. Sin comisiones ni tipo de cambio.</p>
        <p>{TAX_COPY}</p>
      </div>
    </div>
  )
}

const typed = (x: number) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(x)
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

  // Screen readers hear the summary after a pause or on blur, not on every keystroke.
  const [announced, setAnnounced] = useState(summary)
  useEffect(() => {
    const id = setTimeout(() => setAnnounced(summary), 600)
    return () => clearTimeout(id)
  }, [summary])
  const amountHint = amountValue !== null && !amountFormatError && amount.trim() !== '' ? `Interpretado: ${mode === 'usd' ? 'USD' : 'VN'} ${typed(amountValue)}` : null
  const priceHint = manualValue !== null ? `Interpretado: ${typed(manualValue)} por 100 VN` : null
  const describe = (invalid: boolean, hint: string | null, id: string) => [hint ? id : null, invalid ? 'sim-status' : null].filter(Boolean).join(' ') || undefined

  return (
    <section className="min-w-0" aria-labelledby="sim-title">
      <SectionHead id="sim-title" title="Simulador de pagos" />
      <div className="pt-4">
      {floating ? (
        <p className="text-ink-2">No simulable: tasa variable. Los cupones de una tasa variable no se proyectan.</p>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-start gap-4 max-[1080px]:grid-cols-2 max-[819px]:grid-cols-1">
            <fieldset className="max-[1080px]:col-span-2 max-[819px]:col-span-1">
              <legend className={cn(labelCls, 'mb-1')}>Ingresar</legend>
              <div className="flex flex-wrap gap-x-5">
                {MODES.map((m) => (
                  <label key={m.id} className="flex min-h-9 cursor-pointer items-center gap-2 max-[819px]:min-h-11">
                    <input type="radio" name="sim-mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="h-4 w-4 accent-[var(--accent)]" />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-1">
              <label htmlFor="sim-amount" className={labelCls}>{mode === 'usd' ? 'Monto (USD)' : 'Valor nominal (VN)'}</label>
              <input id="sim-amount" className={field} type="text" inputMode="decimal" autoComplete="off" value={amount} aria-invalid={amountInvalid || undefined} aria-describedby={describe(amountInvalid, amountHint, 'sim-amount-hint')} onChange={(e) => setAmount(e.target.value)} onBlur={() => setAnnounced(summary)} />
              {amountHint && <p id="sim-amount-hint" className={hintCls}>{amountHint}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="sim-price" className={labelCls}>Precio manual (opcional, sucio por 100 VN)</label>
              <input id="sim-price" className={field} type="text" inputMode="decimal" autoComplete="off" placeholder={analysis.row.price !== null ? fmtNum(analysis.row.price) : 'Sin precio de mercado'} value={manual} aria-invalid={priceInvalid || undefined} aria-describedby={describe(priceInvalid, priceHint, 'sim-price-hint')} onChange={(e) => setManual(e.target.value)} onBlur={() => setAnnounced(summary)} />
              {priceHint && <p id="sim-price-hint" className={hintCls}>{priceHint}</p>}
            </div>
          </div>
          <p id="sim-status" aria-live="polite" className={error ? 'text-sm font-medium text-danger' : 'sr-only'}>{error ?? announced}</p>
          {result?.ok && <Result r={result} analysis={analysis} />}
        </div>
      )}
      </div>
    </section>
  )
}
