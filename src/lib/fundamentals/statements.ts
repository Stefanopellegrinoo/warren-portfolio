/**
 * Balances completos (odd/tasks/asset-page.md T11 T12, S8): Resultados, Balance and Flujo de caja, one row per
 * line, one column per quarter or year. A row reads one source across all its columns: the SEC for a US 10-Q
 * filer's lines (since about 2009), Yahoo, or TradingView for its eight lines from the 8-year range on, whichever
 * runs unbroken longest to the latest period (`tableOf`).
 * Amounts and EPS go to USD at each period end through metrics' own conversion (L11, L21 a, L36); share counts
 * stay as reported.
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
  /** EPS goes to USD like amounts but keeps its cents; a count of shares is never converted. */
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
  income('dilutedEps', 'Ganancia por acción (US$)', 'La ganancia neta dividida por todas las acciones, contando las que podría emitir (opciones de empleados, bonos convertibles).', { tv: 'epsDiluted', unit: 'perShare' }),
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
  /** The statements' own currency: amounts and EPS were converted from it to USD. */
  currency: string | null
  quarterly: Lines
  annual: Lines
}

/** GET /api/asset/[ticker]/statements: the listing Números reads, keyed by the page's line names. */
export interface AssetStatements {
  yahoo: SourceStatements | null
  /** Its eight history lines only. */
  tradingview: SourceStatements | null
  /** A US 10-Q filer's official lines, every period since about 2009 (T12). Absent while the SEC is off; null for anyone else. */
  sec?: SourceStatements | null
  sources: Partial<Record<'tradingview' | 'yahoo' | 'fx' | 'sec', SourceStatus>>
}

/** The points within `years` before `latest`: 8 years from 2026-06-30 starts at 2018-09-30. Infinity keeps them all. */
export function within(series: Series, years: number, latest = series.at(-1)?.end): Series {
  if (!latest) return []
  if (years === Infinity) return series
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

/**
 * Each source's shown lines, amounts in USD (whole dollars) and EPS in USD, at most MAX_YEARS (the SEC's all):
 * the route's whole payload. `sec` is the SEC's lines in USD; leaving it out (SEC off) leaves the key out.
 */
export function toStatements(
  tv: TvHistory | null,
  yahoo: YahooStatements | null,
  rates: Map<string, Map<string, number>>,
  sec?: Pick<SourceStatements, 'quarterly' | 'annual'> | null,
): Pick<AssetStatements, 'yahoo' | 'tradingview' | 'sec'> {
  const rateOn = ratesReader(rates)
  function read<L extends string>(book: Book<L>, lineOf: (def: LineDef) => L | undefined, years = MAX_YEARS): SourceStatements {
    const usd = inUsd(book, rateOn)
    const side = (mode: StatementMode): Lines =>
      Object.fromEntries(
        LINES.flatMap((def) => {
          const line = lineOf(def)
          const series = line && (def.unit === 'count' ? book[mode][line] : usd[mode][line]?.map((p) => ({ end: p.end, value: def.unit ? p.value : Math.round(p.value) })))
          return series?.length ? [[def.id, within(series, years)]] : []
        }),
      )
    return { currency: book.currency, quarterly: side('quarterly'), annual: side('annual') }
  }
  /** Flujo de caja libre is OCF − |CapEx| for every source that has both (L22), never a source's own line. */
  function withFcf(s: SourceStatements): SourceStatements {
    for (const mode of STATEMENT_MODES) {
      const { freeCashFlow: _, ...rest } = s[mode]
      const fcf = freeCashFlow(rest.operatingCashFlow, rest.capitalExpenditure)
      s[mode] = fcf.length ? { ...rest, freeCashFlow: fcf } : rest
    }
    return s
  }
  const out = {
    yahoo: yahoo && withFcf(read(yahooBook(yahoo), (def) => def.id)),
    tradingview: tv && read(tvBook(tv), (def) => def.tv),
  }
  if (sec === undefined) return out
  return { ...out, sec: sec && withFcf(read({ currency: 'USD', ...sec, shares: () => null }, (def) => def.id, Infinity)) }
}

export interface StatementRow {
  def: LineDef
  source: 'sec' | 'yahoo' | 'tradingview'
  /** The statements' own currency, before the conversion to USD. */
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

/** More than one period between two ends, 1,5 or more apart: a hole in a row, a "…" between two columns (L38). */
export function isGap(older: string, newer: string, mode: StatementMode): boolean {
  const months = (Number(newer.slice(0, 4)) - Number(older.slice(0, 4))) * 12 + Number(newer.slice(5, 7)) - Number(older.slice(5, 7))
  return months > (mode === 'annual' ? 18 : 4.5)
}

/**
 * One statement as a table over `years` (Infinity: all): each row from one source over the range, and the columns
 * any row has. A row's source is the one with the longest unbroken run of periods, within the range, up to the
 * latest period any of them has (L38 D2); a tie goes to the SEC, then TradingView (8-year range on only, S8), then
 * Yahoo.
 */
export function tableOf(s: AssetStatements, statement: StatementId, mode: StatementMode, years: number): StatementTable {
  const picked = LINES.filter((d) => d.statement === statement).flatMap((def): Omit<StatementRow, 'since'>[] => {
    const options = (['sec', 'tradingview', 'yahoo'] as const)
      .filter((source) => source !== 'tradingview' || (years >= MAX_YEARS && def.tv))
      .flatMap((source) => {
        const from = s[source]
        const series = from?.[mode][def.id]
        return from && series?.length ? [{ def, source, currency: from.currency, series }] : []
      })
    const latest = options.map((o) => columnOf(o.series[o.series.length - 1].end, mode)).sort().at(-1)
    const run = (series: Series) => {
      const shown = within(series, years)
      if (columnOf(shown[shown.length - 1].end, mode) !== latest) return 0
      let n = 1
      while (n < shown.length && !isGap(shown[shown.length - n - 1].end, shown[shown.length - n].end, mode)) n++
      return n
    }
    return options.length ? [options.reduce((a, b) => (run(b.series) > run(a.series) ? b : a))] : []
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
