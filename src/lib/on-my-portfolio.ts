// "Mi cartera de ONs": what the user holds TODAY, projected forward (pure: no DB, no network).
// Future payments depend only on the current holdings, never on trade dates. The per-ON math is
// simulateHeld and the portfolio view is the same aggregate used by the test portfolios.
import { aggregate, MATURED_MESSAGE, type Position, type PortfolioAnalysis, type PortfolioPayment, type PortfolioWarning } from './on-portfolio-analytics'
import type { OnAnalysis } from './on-analytics'
import { fmtDate, fmtNum, fmtVn } from './on-format'
import { simulateHeld } from './on-simulator'

export interface Holding { ticker: string; quantity: number } // quantity = VN / 100, as in on_positions
export interface UnmappedHolding { ticker: string; vn: number }
export interface MyOnPortfolio { analysis: PortfolioAnalysis; unmapped: UnmappedHolding[] }

const key = (t: string | null | undefined) => (t ?? '').trim().toUpperCase()
const usd = (x: number) => `USD ${fmtNum(x)}`

/** ticker -> ISIN, trying the D line first, then C, then O (a ticker is never reassigned by a later line). */
function tickerIndex(analyses: OnAnalysis[]): Map<string, string> {
  const idx = new Map<string, string>()
  const lines = [(a: OnAnalysis) => a.row.tickerD, (a: OnAnalysis) => a.detail.tickerC, (a: OnAnalysis) => a.row.tickerO]
  for (const line of lines) for (const a of analyses) { const k = key(line(a)); if (k && !idx.has(k)) idx.set(k, a.row.isin) }
  return idx
}

/**
 * `ownPrices`: quote of each held ticker on ITS OWN line (upper-case ticker -> dirty price per 100 VN), so the market value
 * matches the dashboard. Yields always use the payment-plaza price line of the catalog.
 */
export function buildMyOnPortfolio({ holdings, analyses, today, ownPrices = {} }: { holdings: Holding[]; analyses: OnAnalysis[]; today: string; ownPrices?: Record<string, number> }): MyOnPortfolio {
  const byIsin = new Map(analyses.map((a) => [a.row.isin, a]))
  const index = tickerIndex(analyses)
  const vnByIsin = new Map<string, number>()
  const ownPricesGiven = Object.keys(ownPrices).length > 0
  const ownValue = new Map<string, { vn: number; usd: number }>() // holdings that have a quote on their own line
  const unmappedVn = new Map<string, number>()
  for (const h of holdings) {
    if (!(h.quantity > 0) || !Number.isFinite(h.quantity)) continue
    const vn = h.quantity * 100
    const isin = index.get(key(h.ticker))
    if (isin) {
      vnByIsin.set(isin, (vnByIsin.get(isin) ?? 0) + vn)
      const px = ownPrices[key(h.ticker)]
      if (px > 0) {
        const cur = ownValue.get(isin) ?? { vn: 0, usd: 0 }
        ownValue.set(isin, { vn: cur.vn + vn, usd: cur.usd + (vn * px) / 100 })
      }
    }
    else unmappedVn.set(key(h.ticker), (unmappedVn.get(key(h.ticker)) ?? 0) + vn)
  }
  const unmapped = [...unmappedVn.entries()].map(([ticker, vn]) => ({ ticker, vn }))

  const positions: Position[] = []
  const payments: PortfolioPayment[] = []
  const skipped: PortfolioAnalysis['skipped'] = []
  const warnings: PortfolioWarning[] = unmapped.map((u) => ({ kind: 'unmapped', isin: u.ticker, message: `${u.ticker}: ${fmtVn(u.vn)} sin términos en el catálogo; no se proyectan sus cobros.` }))
  let settle = ''

  for (const [isin, vn] of vnByIsin) {
    const analysis = byIsin.get(isin)!
    const { row, detail } = analysis
    const tk = row.tickerD ?? row.tickerO
    const warn = (kind: PortfolioWarning['kind'], message: string) => warnings.push({ kind, isin, message: `${tk}: ${message}` })
    const r = simulateHeld({ analysis, vn, today })
    if (!r.ok) {
      skipped.push({ isin, reason: r.reason === 'not-usd' ? 'not-usd' : 'no-payments', message: `${tk}: ${r.reason === 'no-payments' ? MATURED_MESSAGE : r.message}` })
      warn(r.reason === 'not-usd' ? 'not-usd' : 'invalid', r.reason === 'no-payments' ? MATURED_MESSAGE : r.message)
      continue
    }
    settle = r.settle
    // Market value: own-line quotes where we have them; the rest of the VN is valued at the plaza price (and warned).
    const own = ownValue.get(isin) ?? { vn: 0, usd: 0 }
    const rest = vn - own.vn
    const plazaValue = r.marketValue // null without a plaza-line price
    const restValue = rest > 1e-9 ? (r.pricePct === null ? null : (rest * r.pricePct) / 100) : 0
    const marketValue = restValue === null ? (own.vn > 0 ? own.usd : null) : own.usd + restValue
    positions.push({
      isin, ticker: tk, tickerO: row.tickerO, issuer: row.issuer, plaza: row.plaza, maturityDate: row.maturityDate,
      vn, cost: marketValue ?? 0, yieldValue: plazaValue, weightPct: 0, pricePct: r.pricePct ?? 0, ytmPct: r.ytmPct, mdYears: r.mdYears, ytwKind: null,
      collected: r.payments.reduce((s, p) => s + p.total, 0), priced: marketValue !== null, nextPayDate: null, nextPayAmount: null,
    })
    for (const p of r.payments) payments.push({ isin, ticker: tk, date: p.date, payDate: p.payDate, interest: p.interest, principal: p.principal, total: p.total, exForBuyer: p.recordPassed })

    if (r.floating) warn('floating', 'tasa variable: se lista, pero sus cobros no se proyectan.')
    if (ownPricesGiven && !r.floating && rest > 1e-9 && restValue !== null) warn('price-fallback', 'sin cotización propia del ticker: se valuó con el precio de la línea de pago.')
    if (r.pricePct === null && !r.floating && marketValue === null) warn('no-price', 'sin precio: se proyectan los cobros, pero no hay valor de mercado ni TIR.')
    for (const p of r.payments.filter((x) => x.recordPassed)) {
      warn('held-record-passed', `corte ya pasado: lo cobrás (${usd(p.interest)} de interés el ${fmtDate(p.payDate)}).`)
    }
    if (row.law === 'NY' && ['secondary', 'default'].includes(detail.terms.dayCount.prov)) {
      warn('day-count-unverified', `base de cálculo ${detail.terms.dayCount.value} sin verificar; el interés proyectado puede diferir.`)
    }
    if (row.events.length > 0) warn('event', `tiene eventos societarios registrados (${row.events.map((e) => e.kind).join(', ')}); revisá el detalle de la ON.`)
    if (r.pricePct !== null && r.lineFallback && r.priceLine !== 'O') warn('price-fallback', 'el precio es de otra línea que la de su plaza de pago.')
    if (r.pricePct !== null && r.noTrades) warn('reference-price', 'el precio es de referencia, la línea no operó en la rueda.')
  }

  return { analysis: aggregate({ positions, payments, skipped, warnings, settle, today }), unmapped }
}
