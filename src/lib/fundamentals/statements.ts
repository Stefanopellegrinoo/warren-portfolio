/**
 * Balances completos (odd/tasks/asset-page.md T11, S8): Resultados, Balance and Flujo de caja, one row per
 * line, one column per quarter or year. A row reads one source across all its columns: Yahoo, or
 * TradingView for its eight lines in the 8-year range. Amounts go to USD at each period end through
 * metrics' own conversion (L11, L21 a); EPS and share counts stay as reported.
 *
 * Pure, with type-only server imports: safe for the client bundle.
 */
import { inUsd, ratesReader, tvBook, yahooBook, yearEarlier, type Book } from './metrics'
import type { SourceStatus } from './service'
import type { TvHistory, TvHistoryLine } from './tradingview'
import type { YahooLine, YahooStatements } from './yahoo'
import type { Series } from './types'

export const STATEMENTS = [
  { id: 'income', label: 'Resultados' },
  { id: 'balance', label: 'Balance' },
  { id: 'cashflow', label: 'Flujo de caja' },
] as const
export type StatementId = (typeof STATEMENTS)[number]['id']
export const STATEMENT_MODES = ['quarterly', 'annual'] as const
export type StatementMode = (typeof STATEMENT_MODES)[number]
/** The longest range: TradingView's 32 quarters. */
export const MAX_YEARS = 8

export interface LineDef {
  id: YahooLine
  statement: StatementId
  label: string
  /** The "?": what it is, for someone who never read a balance sheet. */
  help: string
  /** The TradingView history line that replaces Yahoo's for the whole row in the 8-year range (S8). */
  tv?: TvHistoryLine
  /** Not an amount, so never converted: EPS in the statements' currency, a count of shares. */
  unit?: 'perShare' | 'count'
}

const income = (id: YahooLine, label: string, help: string, more: Partial<LineDef> = {}): LineDef => ({ id, statement: 'income', label, help, ...more })
const balance = (id: YahooLine, label: string, help: string, more: Partial<LineDef> = {}): LineDef => ({ id, statement: 'balance', label, help, ...more })
const cash = (id: YahooLine, label: string, help: string, more: Partial<LineDef> = {}): LineDef => ({ id, statement: 'cashflow', label, help, ...more })
const OUTFLOW = 'Es plata que sale, por eso va con signo menos.'

/** Every row, in the order each statement reads. */
export const LINES: readonly LineDef[] = [
  income('revenue', 'Ventas', 'Todo lo que la empresa cobró por lo que vende en el período.', { tv: 'revenue' }),
  income('costOfRevenue', 'Costo de ventas', 'Lo que le costó producir o comprar lo que vendió.'),
  income('grossProfit', 'Ganancia bruta', 'Ventas menos costo de ventas: lo que queda antes de pagar oficinas, publicidad e investigación.', { tv: 'grossProfit' }),
  income('researchAndDevelopment', 'Investigación y desarrollo', 'Lo que gastó en crear productos y tecnología nuevos.'),
  income('sellingGeneralAndAdministration', 'Gastos de venta y administración', 'Sueldos de oficina, alquileres, publicidad y todo lo que cuesta vender y manejar la empresa.'),
  income('operatingIncome', 'Resultado operativo', 'Lo que gana el negocio en sí, antes de intereses e impuestos.'),
  income('interestExpense', 'Intereses pagados', 'Lo que pagó de intereses por sus deudas en el período.'),
  income('pretaxIncome', 'Ganancia antes de impuestos', 'Lo que ganó antes de pagar el impuesto a las ganancias.'),
  income('taxProvision', 'Impuesto a las ganancias', 'Lo que le toca pagar de impuesto sobre lo que ganó en el período.'),
  income('netIncome', 'Ganancia neta', 'Lo que le quedó después de pagar todo, impuestos incluidos. En rojo, perdió plata.', { tv: 'netIncome' }),
  income('ebit', 'EBIT', 'Lo que gana el negocio antes de intereses e impuestos, sumando resultados que no son de su operación.'),
  income('ebitda', 'EBITDA', 'Lo que gana el negocio antes de intereses, impuestos y amortizaciones: el desgaste de lo que compró en otros años.', { tv: 'ebitda' }),
  income('dilutedEps', 'Ganancia por acción (diluida)', 'La ganancia neta dividida por todas las acciones, contando las que podría emitir (opciones de empleados, bonos convertibles).', { tv: 'epsDiluted', unit: 'perShare' }),
  income('dilutedAverageShares', 'Acciones (promedio diluido)', 'Cuántas acciones hubo en promedio en el período, contando las que podría emitir. Si sube, cada acción es dueña de una parte más chica.', { unit: 'count' }),
  balance('totalAssets', 'Activos', 'Todo lo que la empresa tiene: plata, lo que le deben, mercadería, edificios, máquinas y empresas que compró.', { tv: 'totalAssets' }),
  balance('currentAssets', 'Activo corriente', 'Lo que tiene y puede convertir en plata en menos de un año.'),
  balance('cashAndCashEquivalents', 'Caja', 'La plata que tiene disponible ya.'),
  balance('cashAndShortTermInvestments', 'Caja e inversiones de corto plazo', 'La caja más las inversiones que puede vender rápido, como bonos del Tesoro.'),
  balance('accountsReceivable', 'Cuentas a cobrar', 'Lo que sus clientes le deben por ventas ya hechas.'),
  balance('inventory', 'Inventario', 'La mercadería que tiene para vender o para fabricar.'),
  balance('netPPE', 'Bienes de uso', 'Edificios, terrenos, máquinas y equipos, menos su desgaste.'),
  balance('goodwill', 'Llave de negocio', 'Lo que pagó de más al comprar otras empresas, por encima de lo que valían sus cosas.'),
  balance('totalLiabilities', 'Pasivos', 'Todo lo que la empresa debe: deudas, proveedores, sueldos e impuestos a pagar.'),
  balance('currentLiabilities', 'Pasivo corriente', 'Lo que tiene que pagar en menos de un año.'),
  balance('accountsPayable', 'Cuentas a pagar', 'Lo que les debe a sus proveedores.'),
  balance('totalDebt', 'Deuda total', 'Lo que debe a bancos y a quienes compraron sus bonos, a cualquier plazo.', { tv: 'totalDebt' }),
  balance('longTermDebt', 'Deuda de largo plazo', 'La parte de la deuda que vence en más de un año.'),
  balance('stockholdersEquity', 'Patrimonio', 'Activos menos pasivos: lo que les quedaría a los dueños si vendiera todo y pagara todas sus deudas.'),
  balance('workingCapital', 'Capital de trabajo', 'Activo corriente menos pasivo corriente. Positivo: lo que tiene a menos de un año alcanza para lo que debe a menos de un año.'),
  balance('ordinarySharesNumber', 'Acciones emitidas', 'Cuántas acciones existen al cierre. Si baja, la empresa recompró acciones.', { unit: 'count' }),
  cash('operatingCashFlow', 'Flujo de caja operativo', 'La plata que dejó el negocio en sí, cobrando y pagando el día a día.'),
  cash('capitalExpenditure', 'Inversión (CapEx)', `Lo que gastó en edificios, máquinas y equipos para seguir creciendo. ${OUTFLOW}`),
  cash('freeCashFlow', 'Flujo de caja libre', 'Flujo de caja operativo menos la inversión: la plata que queda libre para pagar deudas, dividendos o recomprar acciones.', { tv: 'freeCashFlow' }),
  cash('investingCashFlow', 'Flujo de inversión', 'Lo que entró o salió por comprar y vender bienes, empresas e inversiones. Negativo: invirtió más de lo que vendió.'),
  cash('financingCashFlow', 'Flujo de financiación', 'Lo que entró o salió por deudas, acciones y dividendos. Negativo: devolvió más plata a bancos o accionistas de la que pidió.'),
  cash('repurchaseOfCapitalStock', 'Recompra de acciones', `Lo que gastó en comprar sus propias acciones. ${OUTFLOW}`),
  cash('cashDividendsPaid', 'Dividendos pagados', `Lo que les pagó a sus accionistas en efectivo. ${OUTFLOW}`),
]

type Lines = Partial<Record<YahooLine, Series>>

export interface SourceStatements {
  /** The statements' own currency: amounts were converted from it, EPS is still in it. */
  currency: string | null
  quarterly: Lines
  annual: Lines
}

/** GET /api/asset/[ticker]/statements: the listing Números reads, keyed by the page's line names. */
export interface AssetStatements {
  yahoo: SourceStatements | null
  /** Its eight history lines only. */
  tradingview: SourceStatements | null
  sources: Partial<Record<'tradingview' | 'yahoo' | 'fx', SourceStatus>>
}

/** The points within `years` before `latest`: 8 years from 2026-06-30 starts at 2018-09-30. */
export function within(series: Series, years: number, latest = series.at(-1)?.end): Series {
  if (!latest) return []
  const cut = `${Number(latest.slice(0, 4)) - years}${latest.slice(4)}`
  return series.filter((p) => p.end > cut)
}

/** Operating cash flow − |CapEx| per period (L22): Yahoo's own line equals OCF where CapEx is missing. */
export function freeCashFlow(ocf: Series = [], capex: Series = []): Series {
  return ocf.flatMap((p) => {
    const c = capex.find((q) => q.end === p.end)
    return c ? [{ end: p.end, value: p.value - Math.abs(c.value) }] : []
  })
}

/** Each source's shown lines, amounts in USD (whole dollars), at most MAX_YEARS: the route's whole payload. */
export function toStatements(
  tv: TvHistory | null,
  yahoo: YahooStatements | null,
  rates: Map<string, Map<string, number>>,
): Pick<AssetStatements, 'yahoo' | 'tradingview'> {
  const rateOn = ratesReader(rates)
  function read<L extends string>(book: Book<L>, lineOf: (def: LineDef) => L | undefined): SourceStatements {
    const usd = inUsd(book, rateOn)
    const side = (mode: StatementMode): Lines =>
      Object.fromEntries(
        LINES.flatMap((def) => {
          const line = lineOf(def)
          const series = line && (def.unit ? book[mode][line] : usd[mode][line]?.map((p) => ({ end: p.end, value: Math.round(p.value) })))
          return series?.length ? [[def.id, within(series, MAX_YEARS)]] : []
        }),
      )
    return { currency: book.currency, quarterly: side('quarterly'), annual: side('annual') }
  }
  const y = yahoo && read(yahooBook(yahoo), (def) => def.id)
  if (y) {
    for (const mode of STATEMENT_MODES) {
      const { freeCashFlow: _, ...rest } = y[mode]
      const fcf = freeCashFlow(rest.operatingCashFlow, rest.capitalExpenditure)
      y[mode] = fcf.length ? { ...rest, freeCashFlow: fcf } : rest
    }
  }
  return { yahoo: y, tradingview: tv && read(tvBook(tv), (def) => def.tv) }
}

export interface StatementRow {
  def: LineDef
  source: 'yahoo' | 'tradingview'
  /** The statements' currency: EPS is in it. */
  currency: string | null
  /** Oldest first, within the range. */
  series: Series
  /** Its first year, when later than the table's first column's: a shorter source says so (S8). */
  since: string | null
}

export interface StatementTable {
  /** One period end per column, newest first. */
  columns: string[]
  rows: StatementRow[]
}

/**
 * A period's column: its year, or its quarter's last month, so one source's 2026-06-28 and another's
 * 2026-06-30 share one. ponytail: a quarter ending on the 1st of a month would get its own column.
 */
export const columnOf = (end: string, mode: StatementMode) => (mode === 'annual' ? end.slice(0, 4) : end.slice(0, 7))

/** One statement as a table: each row from one source over the range, and the columns any row has. */
export function tableOf(s: AssetStatements, statement: StatementId, mode: StatementMode, years: number): StatementTable {
  const picked = LINES.filter((d) => d.statement === statement).flatMap((def): Omit<StatementRow, 'since'>[] => {
    const fromTv = years >= MAX_YEARS && !!def.tv && !!s.tradingview?.[mode][def.id]?.length
    const from = fromTv ? s.tradingview : s.yahoo
    const series = from?.[mode][def.id]
    return from && series?.length ? [{ def, source: fromTv ? 'tradingview' : 'yahoo', currency: from.currency, series }] : []
  })
  const latest = picked.map((r) => r.series[r.series.length - 1].end).sort().at(-1)
  const rows = picked.map((r) => ({ ...r, series: within(r.series, years, latest) })).filter((r) => r.series.length > 0)
  const ends = new Map<string, string>()
  for (const p of rows.flatMap((r) => r.series)) {
    const key = columnOf(p.end, mode)
    if ((ends.get(key) ?? '') < p.end) ends.set(key, p.end)
  }
  const columns = [...ends.values()].sort().reverse()
  const first = columns.at(-1)?.slice(0, 4) ?? ''
  return { columns, rows: rows.map((r) => ({ ...r, since: r.series[0].end.slice(0, 4) > first ? r.series[0].end.slice(0, 4) : null })) }
}

/** ▲ 1 or ▼ −1 against the same period a year earlier; 0 when equal or without that period. */
export function trend(series: Series, end: string): -1 | 0 | 1 {
  const now = series.find((p) => p.end === end)
  const then = yearEarlier(series, end)
  return now === undefined || then === null ? 0 : (Math.sign(now.value - then) as -1 | 0 | 1)
}
