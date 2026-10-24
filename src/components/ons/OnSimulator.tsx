'use client'

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { simulateOn, type SimPayment, type SimResult } from '@/lib/on-simulator'
import type { OnAnalysis } from '@/lib/on-analytics'
import { fmtDate, fmtNum, fmtPct, fmtVn, lineLabel, parseEsArNumber, plazaCopy } from '@/lib/on-format'
import { argentinaDate, cn } from '@/lib/utils'
import { SectionHead } from '@/components/resumen/ui'
import { btnQuiet, Disclosure, field, HEAD_ROW, hint as hintCls, label as labelCls, Metric, Metrics, notice, ScrollTable, signedUsd, signTone, TD, TH, TR } from './ui'

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
// The lead numbers: five on a wide screen, three on a tablet, two on a phone.
const LEAD_GRID = 'grid-cols-5 max-[1280px]:grid-cols-3 max-[819px]:grid-cols-2'

function Lead({ label, children, hint, valueClass }: { label: string; children: ReactNode; hint?: ReactNode; valueClass?: string }) {
  return <Metric label={label} value={children} hint={hint} valueClass={cn('text-xl', valueClass)} />
}

const shifted = (p: SimPayment) => (p.payDate !== p.date ? `día hábil siguiente al ${fmtDate(p.date)}` : null)
const skipped = (p: SimPayment) => `no cobrás el cupón: los ${usd(p.skippedInterest)} son de quien vendió`

/** Phones and tablets: one line per payment (date and total), what it is made of below. */
function PaymentList({ payments }: { payments: SimPayment[] }) {
  return (
    <ul aria-label="Pagos futuros de la tenencia simulada, en dólares" className="max-w-[40rem] min-[1281px]:hidden">
      {payments.map((p) => (
        <li key={p.date} className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
          <div className="min-w-0">
            <p className="font-medium tabular-nums">{fmtDate(p.payDate)}</p>
            <p className="text-[13px] tabular-nums text-ink-3">Interés {fmtNum(p.interest)}{p.principal > 0 && ` · capital ${fmtNum(p.principal)}`}</p>
            {shifted(p) && <p className="text-xs text-ink-3">{shifted(p)}</p>}
            {p.exCoupon && <p className="text-xs text-warn">{skipped(p)}</p>}
          </div>
          <p className="whitespace-nowrap text-right font-medium tabular-nums">{usd(p.total)}</p>
        </li>
      ))}
    </ul>
  )
}

function PaymentTable({ payments }: { payments: SimPayment[] }) {
  return (
    <ScrollTable label="Pagos futuros de la tenencia simulada" className="max-[1280px]:hidden">
      <table className="w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">Pagos futuros de la tenencia simulada, en dólares</caption>
        <thead>
          <tr className={`${HEAD_ROW} text-right`}>
            <th scope="col" className={`${TH} text-left`}>Fecha de pago</th>
            <th scope="col" className={TH}>Interés</th>
            <th scope="col" className={TH}>Capital</th>
            <th scope="col" className={TH}>Total</th>
            <th scope="col" className={TH}>Acumulado</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.date} className={`${TR} text-right`}>
              <td className={`${TD} text-left`}>
                {fmtDate(p.payDate)}
                {shifted(p) && <span className="ml-1.5 text-xs text-ink-3">({shifted(p)})</span>}
              </td>
              <td className={TD}>
                {fmtNum(p.interest)}
                {p.exCoupon && <span className="ml-1.5 text-xs text-warn">{skipped(p)}</span>}
              </td>
              <td className={TD}>{fmtNum(p.principal)}</td>
              <td className={cn(TD, 'font-medium')}>{fmtNum(p.total)}</td>
              <td className={TD}>{fmtNum(p.cumulative)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  )
}

function Result({ r, analysis }: { r: Extract<SimResult, { ok: true }>; analysis: OnAnalysis }) {
  const { row } = analysis
  const source = r.priceSource === 'manual' ? 'precio manual' : lineLabel(r.priceLine, row.cclUsed)
  const planned = r.plaza === 'CCL' ? 'cable' : r.plaza === 'MEP' ? 'MEP' : null
  const warnings = [
    ...r.notes,
    ...(r.lineFallback && r.priceLine !== 'O' && planned ? [`Atención: el precio es de la línea ${r.priceLine}, pero la ON paga en dólar ${planned}: el canje no está incluido en el precio ni en la TIR.`] : []),
  ]
  const callable = r.ytw?.kind === 'call'
  return (
    <div className="grid gap-5">
      <Metrics className={LEAD_GRID}>
        <Lead label="Comprás" hint={`Liquidación T+1: ${fmtDate(r.settle)}`}>{fmtVn(r.vn)}</Lead>
        <Lead label="Pagás" hint={r.leftover > 0.005 ? `Sobran ${usd(r.leftover)} del monto ingresado` : undefined}>{usd(r.cost)}</Lead>
        <Lead label="Cobrás en total" hint={`Intereses ${usd(r.totalInterest)} + capital ${usd(r.totalPrincipal)}`}>{usd(r.totalCollected)}</Lead>
        <Lead label="Ganancia" valueClass={signTone(r.profit)} hint={r.paybackDate ? `Recuperás lo invertido el ${fmtDate(r.paybackDate)}` : 'No se recupera lo invertido con los pagos'}>{signedUsd(r.profit, fmtNum)}</Lead>
        <Lead label="TIR (rinde por año)" hint={callable ? 'Si no la rescatan antes: mirá el rendimiento al peor en el detalle' : 'Si la tenés hasta el vencimiento'}>{fmtPct(r.ytmPct)}</Lead>
      </Metrics>

      {warnings.length > 0 && (
        <ul className={cn(notice('warn'), 'space-y-1')}>
          {warnings.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}

      <div className="min-w-0">
        <h3 className="mb-1 text-sm font-semibold">Qué cobrás y cuándo, en dólares</h3>
        <PaymentList payments={r.payments} />
        <PaymentTable payments={r.payments} />
      </div>

      <p className="max-w-[96ch] text-[13px] leading-relaxed text-ink-3">
        {plazaCopy(r.plaza)}, sin importar la línea en la que comprás. Si una fecha cae en fin de semana o feriado, se paga el día hábil siguiente.{' '}
        <span className="font-medium text-ink-2">Sin impuestos ni reinversión. Sin comisiones ni tipo de cambio.</span>
      </p>

      <Disclosure title="Detalle del cálculo" summary="Precio usado, intereses devengados y más" className="border-t">
        <Metrics>
          <Metric label="Cantidad" value={fmtNum(r.quantity, 2)} hint="VN ÷ 100" />
          <Metric label="Precio sucio usado" value={fmtNum(r.pricePct)} hint={source} />
          <Metric label="Intereses devengados" value={usd(r.accruedUsd)} hint={r.accruedUsd < 0 ? 'Negativo: comprás después de la fecha de registro' : 'Incluidos en el precio sucio'} />
          {r.ytw && (
            <Metric label="Rendimiento al peor (YTW)" value={fmtPct(r.ytw.ytwPct)} hint={r.ytw.kind === 'call' ? `Hasta rescate el ${fmtDate(r.ytw.workoutDate)}. La TIR al vencimiento podría no darse: puede ser rescatado antes.` : `Hasta vencimiento el ${fmtDate(r.ytw.workoutDate)}. La ON tiene rescate anticipado; al precio actual el peor caso es el vencimiento.`} />
          )}
        </Metrics>
        {(r.priceLine === 'O' && row.cclUsed) || r.noTrades ? (
          <div className="mt-3 space-y-1 text-[13px] text-ink-3">
            {r.priceLine === 'O' && row.cclUsed && <p>Precio implícito: línea O (pesos) ÷ CCL de ${fmtNum(row.cclUsed.rate)}.</p>}
            {r.noTrades && <p>El precio es de referencia: la línea no operó en la rueda.</p>}
          </div>
        ) : null}
      </Disclosure>
    </div>
  )
}

const DEFAULT_USD = 1000
/** USD 1.000, or what the minimum lot costs at today's price when that is more (rounded up to 100), so the first result is never a refusal. */
function defaultAmount({ row, detail }: OnAnalysis): string {
  const lot = detail.terms.minDenomination.value
  const lotCost = lot !== null && row.price !== null ? Math.ceil((lot * row.price) / 100 / 100) * 100 : 0
  return String(Math.max(DEFAULT_USD, lotCost))
}

const typed = (x: number) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(x)
const noSubscribe = () => () => {}
const FORMAT_ERROR = 'Formato de número inválido'

/** Single-ON payment simulator: everything is computed in the browser from the detail payload (no writes). */
export default function OnSimulator({ analysis, today, initial }: Props) {
  const [mode, setMode] = useState<'usd' | 'vn'>(initial?.mode ?? 'usd')
  const [amount, setAmount] = useState(initial?.amount ?? defaultAmount(analysis))
  const [manual, setManual] = useState(initial?.manualPrice ?? '')
  const [ownPrice, setOwnPrice] = useState(Boolean(initial?.manualPrice))
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
  // Without a market price the own price is the only way to simulate: the field is always open.
  const noMarketPrice = analysis.row.price === null
  const showPrice = noMarketPrice || ownPrice

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
  const togglePrice = () => {
    if (ownPrice) setManual('')
    setOwnPrice(!ownPrice)
  }

  return (
    <section className="min-w-0" aria-labelledby="sim-title">
      <SectionHead id="sim-title" title="¿Cuánto cobrás?" />
      <div className="pt-4">
      {floating ? (
        <p className="text-ink-2">No simulable: tasa variable. Los cupones de una tasa variable no se proyectan.</p>
      ) : (
        <div className="grid gap-4">
          <p className="text-ink-2">Elegí cuánto comprarías y mirá qué cobrás y cuándo.</p>
          <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
            <fieldset>
              <legend className={cn(labelCls, 'mb-1')}>Calcular por</legend>
              <div className="flex flex-wrap gap-x-5">
                {MODES.map((m) => (
                  <label key={m.id} className="flex min-h-9 cursor-pointer items-center gap-2 max-[819px]:min-h-11">
                    <input type="radio" name="sim-mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="h-4 w-4 accent-[var(--accent)]" />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex w-full max-w-[18rem] flex-col gap-1 max-[819px]:max-w-none">
              <label htmlFor="sim-amount" className={labelCls}>{mode === 'usd' ? 'Monto (USD)' : 'Valor nominal (VN)'}</label>
              <input id="sim-amount" className={field} type="text" inputMode="decimal" autoComplete="off" value={amount} aria-invalid={amountInvalid || undefined} aria-describedby={describe(amountInvalid, amountHint, 'sim-amount-hint')} onChange={(e) => setAmount(e.target.value)} onBlur={() => setAnnounced(summary)} />
              {amountHint && <p id="sim-amount-hint" className={hintCls}>{amountHint}</p>}
            </div>
          </div>
          <div className="grid justify-items-start gap-2">
            {!noMarketPrice && (
              <button type="button" className={cn(btnQuiet, '-ml-3 text-accent-ink')} aria-expanded={showPrice} aria-controls="sim-price-box" onClick={togglePrice}>
                {showPrice ? `Volver al precio de hoy (${fmtNum(analysis.row.price)})` : 'Usar otro precio'}
              </button>
            )}
            {/* `hidden` on a wrapper without a display class, so no utility overrides it. */}
            <div id="sim-price-box" hidden={!showPrice} className="w-full max-w-[18rem]">
              <div className="flex flex-col gap-1">
                <label htmlFor="sim-price" className={labelCls}>Tu precio (sucio, por cada 100 VN)</label>
                <input id="sim-price" className={field} type="text" inputMode="decimal" autoComplete="off" placeholder={analysis.row.price !== null ? fmtNum(analysis.row.price) : 'Sin precio de mercado'} value={manual} aria-invalid={priceInvalid || undefined} aria-describedby={describe(priceInvalid, priceHint, 'sim-price-hint')} onChange={(e) => setManual(e.target.value)} onBlur={() => setAnnounced(summary)} />
                {priceHint && <p id="sim-price-hint" className={hintCls}>{priceHint}</p>}
              </div>
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
