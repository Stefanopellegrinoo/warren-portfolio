/**
 * The Números catalog (odd/tasks/asset-page.md T3, S3 S5 S6): every row of the design's
 * "Metric catalog", in the desktop mockup's order, with the one source and formula behind it.
 *
 * Pure data with type-only imports: safe for the client bundle. metrics.ts evaluates the formulas.
 */
import type { TvHistoryLine, TvSnapshotField } from './tradingview'
import type { YahooLine } from './yahoo'

export const SECTIONS = [
  'Valoración', 'Estadísticas clave', 'Rentabilidad', 'Liquidez', 'Solvencia', 'Por acción (US$)', 'Analistas y riesgo',
] as const
export type Section = (typeof SECTIONS)[number]

const FORWARD = 'Esperados por analistas, próximo año'

/**
 * ratio: 2,39 · percent: 5.3 means 5,3 % · usd: an amount · usdPerShare: per listed unit (an ADR,
 * a BYMA share) · count: shares or people · price: in the listing's own currency, like its quote.
 */
export type MetricUnit = 'ratio' | 'percent' | 'usd' | 'usdPerShare' | 'count' | 'price'

/** One period of one company in one source. Amounts are USD at the period end; null when missing. */
export interface Frame<L extends string> {
  /** The period's flow: the quarter, the last four quarters, or the fiscal year. */
  flow(line: L): number | null
  /** The same flow a year earlier: the same quarter, the 12 months, or the fiscal year before. */
  yearAgo(line: L): number | null
  /** A flow over a year, to set against a balance or a price: the quarter ×4 in quarterly mode. */
  yearly(line: L): number | null
  /** The balance at the period end. */
  bal(line: L): number | null
  /** The mean of the balances at the period's start and end (a year apart for TTM and annual). */
  avg(line: L): number | null
  /** Market cap: today's for "hoy", else the listing's price at the period end × listed units then. */
  mcap: number | null
  /** Listed units (what the price is quoted per) at the period end. */
  units: number | null
}

type Better = 'higher' | 'lower'
interface Row {
  id: string
  section: Section
  subsection?: typeof FORWARD
  label: string
  unit: MetricUnit
  /**
   * The value is the period's own flow, not a ratio of flows nor annualized: a quarter holds about a
   * fourth of a year, so its quarterly series has no "hoy" point (hoy is on the 12-month scale).
   */
  periodFlow?: true
}
export type MetricDef = Row &
  (
    | { group: 'T'; better: Better; formula: (f: Frame<TvHistoryLine>) => number | null }
    | { group: 'Y'; better: Better; formula: (f: Frame<YahooLine>) => number | null }
    | { group: 'snapshot'; field: TvSnapshotField; better?: Better }
    // Today's quote × listed units in USD, the market cap every price ratio divides (S5).
    | { group: 'quote' }
    // The asked listing's analysts' average target, as Resumen shows it: its Yahoo profile, in its quote's currency (T10, S5).
    | { group: 'profile' }
  )

type N = number | null

/** a / b; null when either is missing or b ≤ 0: a ratio over nothing or over a negative base means nothing. */
const div = (a: N, b: N): N => (a === null || b === null || !(b > 0) ? null : a / b)
const pct = (a: N, b: N): N => {
  const r = div(a, b)
  return r === null ? null : r * 100
}
/** % change from `then` to `now`; null over a base ≤ 0. */
const growth = (now: N, then: N): N => {
  const r = div(now, then)
  return r === null ? null : (r - 1) * 100
}

/** Enterprise value = market cap + total debt − cash and short-term investments. */
function ev(f: Frame<YahooLine>): N {
  const debt = f.bal('totalDebt')
  const cash = f.bal('cashAndShortTermInvestments')
  return f.mcap === null || debt === null || cash === null ? null : f.mcap + debt - cash
}

/** (Current assets − inventory) / current liabilities; no inventory line means none. */
function quick(f: Frame<YahooLine>): N {
  const assets = f.bal('currentAssets')
  return div(assets === null ? null : assets - (f.bal('inventory') ?? 0), f.bal('currentLiabilities'))
}

/** Yahoo books CapEx as a negative cash flow; the row shows what was invested. */
function capex(f: Frame<YahooLine>): N {
  const c = f.flow('capitalExpenditure')
  return div(c === null ? null : Math.abs(c), f.units)
}

/**
 * Operating cash flow − CapEx, from the two lines the page also shows, not Yahoo's freeCashFlow: that line
 * equals OCF where YPFD.BA's CapEx is missing (2026-09-30) and even where it is not (2025-09-30).
 */
function fcf(f: Frame<YahooLine>): N {
  const ocf = f.flow('operatingCashFlow')
  const c = f.flow('capitalExpenditure')
  return div(ocf === null || c === null ? null : ocf - Math.abs(c), f.units)
}

const VAL = 'Valoración'
const PROF = 'Rentabilidad'
const LIQ = 'Liquidez'
const SOLV = 'Solvencia'
const PS = 'Por acción (US$)'

export const METRICS = [
  // Valoración: market cap or EV over the company's own figures, never a per-share price (ADRs).
  { id: 'pe', section: VAL, label: 'P/E (precio / ganancias)', unit: 'ratio', group: 'T', better: 'lower', formula: (f) => div(f.mcap, f.yearly('netIncome')) },
  { id: 'ps', section: VAL, label: 'Precio / ventas', unit: 'ratio', group: 'T', better: 'lower', formula: (f) => div(f.mcap, f.yearly('revenue')) },
  { id: 'pcf', section: VAL, label: 'Precio / flujo de caja', unit: 'ratio', group: 'Y', better: 'lower', formula: (f) => div(f.mcap, f.yearly('operatingCashFlow')) },
  { id: 'pb', section: VAL, label: 'Precio / valor libro', unit: 'ratio', group: 'Y', better: 'lower', formula: (f) => div(f.mcap, f.bal('stockholdersEquity')) },
  { id: 'ev', section: VAL, label: 'Valor de empresa', unit: 'usd', group: 'Y', better: 'higher', formula: ev },
  { id: 'evEbitda', section: VAL, label: 'Valor de empresa / EBITDA', unit: 'ratio', group: 'Y', better: 'lower', formula: (f) => div(ev(f), f.yearly('ebitda')) },
  { id: 'evSales', section: VAL, label: 'Valor de empresa / ventas', unit: 'ratio', group: 'Y', better: 'lower', formula: (f) => div(ev(f), f.yearly('revenue')) },
  { id: 'evEbit', section: VAL, label: 'Valor de empresa / EBIT', unit: 'ratio', group: 'Y', better: 'lower', formula: (f) => div(ev(f), f.yearly('ebit')) },
  { id: 'peForward', section: VAL, subsection: FORWARD, label: 'P/E esperado', unit: 'ratio', group: 'snapshot', field: 'price_earnings_fwd', better: 'lower' },
  { id: 'psForward', section: VAL, subsection: FORWARD, label: 'Precio / ventas esperado', unit: 'ratio', group: 'snapshot', field: 'price_sales_fwd', better: 'lower' },
  { id: 'evEbitdaForward', section: VAL, subsection: FORWARD, label: 'Valor de empresa / EBITDA esperado', unit: 'ratio', group: 'snapshot', field: 'enterprise_value_ebitda_fwd', better: 'lower' },
  { id: 'pbForward', section: VAL, subsection: FORWARD, label: 'Precio / valor libro esperado', unit: 'ratio', group: 'snapshot', field: 'price_book_fwd', better: 'lower' },

  // A size, not a quality: no better side.
  { id: 'marketCap', section: 'Estadísticas clave', label: 'Capitalización', unit: 'usd', group: 'quote' },
  { id: 'sharesOutstanding', section: 'Estadísticas clave', label: 'Acciones en circulación', unit: 'count', group: 'snapshot', field: 'total_shares_outstanding' },
  { id: 'floatShares', section: 'Estadísticas clave', label: 'Capital flotante', unit: 'count', group: 'snapshot', field: 'float_shares_outstanding' },
  { id: 'employees', section: 'Estadísticas clave', label: 'Empleados', unit: 'count', group: 'snapshot', field: 'number_of_employees' },

  // Returns over the period's average balance, as TradingView defines them (MELI's ROA matches it).
  { id: 'roa', section: PROF, label: 'Rentabilidad sobre activos (ROA)', unit: 'percent', group: 'T', better: 'higher', formula: (f) => pct(f.yearly('netIncome'), f.avg('totalAssets')) },
  { id: 'roe', section: PROF, label: 'Rentabilidad sobre patrimonio (ROE)', unit: 'percent', group: 'Y', better: 'higher', formula: (f) => pct(f.yearly('netIncome'), f.avg('stockholdersEquity')) },
  // ponytail: net income over invested capital; NOPAT needs a tax rate Yahoo's lines do not give per period.
  { id: 'roic', section: PROF, label: 'Rentabilidad sobre capital invertido (ROIC)', unit: 'percent', group: 'Y', better: 'higher', formula: (f) => pct(f.yearly('netIncome'), f.avg('investedCapital')) },
  { id: 'grossMargin', section: PROF, label: 'Margen bruto', unit: 'percent', group: 'T', better: 'higher', formula: (f) => pct(f.flow('grossProfit'), f.flow('revenue')) },
  { id: 'operatingMargin', section: PROF, label: 'Margen operativo', unit: 'percent', group: 'Y', better: 'higher', formula: (f) => pct(f.flow('operatingIncome'), f.flow('revenue')) },
  { id: 'ebitdaMargin', section: PROF, label: 'Margen EBITDA', unit: 'percent', group: 'T', better: 'higher', formula: (f) => pct(f.flow('ebitda'), f.flow('revenue')) },
  { id: 'netMargin', section: PROF, label: 'Margen neto', unit: 'percent', group: 'T', better: 'higher', formula: (f) => pct(f.flow('netIncome'), f.flow('revenue')) },
  { id: 'revenueGrowth', section: PROF, label: 'Crecimiento de ventas (12 meses)', unit: 'percent', group: 'T', better: 'higher', formula: (f) => growth(f.flow('revenue'), f.yearAgo('revenue')) },

  { id: 'quickRatio', section: LIQ, label: 'Liquidez inmediata', unit: 'ratio', group: 'Y', better: 'higher', formula: quick },
  { id: 'currentRatio', section: LIQ, label: 'Liquidez corriente', unit: 'ratio', group: 'Y', better: 'higher', formula: (f) => div(f.bal('currentAssets'), f.bal('currentLiabilities')) },
  { id: 'inventoryTurnover', section: LIQ, label: 'Rotación de inventario', unit: 'ratio', group: 'Y', better: 'higher', formula: (f) => div(f.yearly('costOfRevenue'), f.avg('inventory')) },
  // Only TradingView lines, so group T by the design's rule (8 years of history), though it sits in Liquidez.
  { id: 'assetTurnover', section: LIQ, label: 'Rotación de activos', unit: 'ratio', group: 'T', better: 'higher', formula: (f) => div(f.yearly('revenue'), f.avg('totalAssets')) },

  // Every debt and free cash flow figure is Yahoo's (totalDebt; OCF − CapEx), like D/E and EV: one definition each (L21 b).
  { id: 'debtToAssets', section: SOLV, label: 'Deuda / activos', unit: 'ratio', group: 'Y', better: 'lower', formula: (f) => div(f.bal('totalDebt'), f.bal('totalAssets')) },
  { id: 'debtToEquity', section: SOLV, label: 'Deuda / patrimonio', unit: 'ratio', group: 'Y', better: 'lower', formula: (f) => div(f.bal('totalDebt'), f.bal('stockholdersEquity')) },
  { id: 'ltDebtToAssets', section: SOLV, label: 'Deuda largo plazo / activos', unit: 'ratio', group: 'Y', better: 'lower', formula: (f) => div(f.bal('longTermDebt'), f.bal('totalAssets')) },
  { id: 'ltDebtToEquity', section: SOLV, label: 'Deuda largo plazo / patrimonio', unit: 'ratio', group: 'Y', better: 'lower', formula: (f) => div(f.bal('longTermDebt'), f.bal('stockholdersEquity')) },

  // Per listed unit, in USD: the amount converted at the period end over the units then.
  { id: 'revenuePerShare', section: PS, periodFlow: true, label: 'Ventas', unit: 'usdPerShare', group: 'T', better: 'higher', formula: (f) => div(f.flow('revenue'), f.units) },
  { id: 'ocfPerShare', section: PS, periodFlow: true, label: 'Flujo de caja operativo', unit: 'usdPerShare', group: 'Y', better: 'higher', formula: (f) => div(f.flow('operatingCashFlow'), f.units) },
  { id: 'fcfPerShare', section: PS, periodFlow: true, label: 'Flujo de caja libre', unit: 'usdPerShare', group: 'Y', better: 'higher', formula: fcf },
  { id: 'ebitPerShare', section: PS, periodFlow: true, label: 'EBIT', unit: 'usdPerShare', group: 'Y', better: 'higher', formula: (f) => div(f.flow('ebit'), f.units) },
  { id: 'ebitdaPerShare', section: PS, periodFlow: true, label: 'EBITDA', unit: 'usdPerShare', group: 'T', better: 'higher', formula: (f) => div(f.flow('ebitda'), f.units) },
  { id: 'bookPerShare', section: PS, label: 'Valor libro', unit: 'usdPerShare', group: 'Y', better: 'higher', formula: (f) => div(f.bal('stockholdersEquity'), f.units) },
  { id: 'tangibleBookPerShare', section: PS, label: 'Valor libro tangible', unit: 'usdPerShare', group: 'Y', better: 'higher', formula: (f) => div(f.bal('tangibleBookValue'), f.units) },
  { id: 'cashPerShare', section: PS, label: 'Caja', unit: 'usdPerShare', group: 'Y', better: 'higher', formula: (f) => div(f.bal('cashAndShortTermInvestments'), f.units) },
  { id: 'debtPerShare', section: PS, label: 'Deuda', unit: 'usdPerShare', group: 'Y', better: 'lower', formula: (f) => div(f.bal('totalDebt'), f.units) },
  { id: 'workingCapitalPerShare', section: PS, label: 'Capital de trabajo', unit: 'usdPerShare', group: 'Y', better: 'higher', formula: (f) => div(f.bal('workingCapital'), f.units) },
  { id: 'capexPerShare', section: PS, periodFlow: true, label: 'Inversión (CapEx)', unit: 'usdPerShare', group: 'Y', better: 'higher', formula: capex },
  // Net income in USD per listed unit: TradingView's EPS line is per ordinary share in the statements' currency.
  { id: 'eps', section: PS, periodFlow: true, label: 'Ganancia (EPS)', unit: 'usdPerShare', group: 'T', better: 'higher', formula: (f) => div(f.flow('netIncome'), f.units) },

  { id: 'priceTarget', section: 'Analistas y riesgo', label: 'Precio objetivo promedio', unit: 'price', group: 'profile' },
  { id: 'beta', section: 'Analistas y riesgo', label: 'Beta (cuánto se mueve contra el mercado)', unit: 'ratio', group: 'snapshot', field: 'beta_1_year' },
] as const satisfies readonly MetricDef[]

export type MetricId = (typeof METRICS)[number]['id']
