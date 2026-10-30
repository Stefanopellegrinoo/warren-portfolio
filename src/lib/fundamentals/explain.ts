/**
 * The words of the Números tab (odd/tasks/asset-page.md T6, S2 S3): each metric's value as the
 * list shows it, its "?" explanation for someone who never read a balance sheet, and "¿Cómo
 * viene?", which says only what the numbers show, never why.
 *
 * Pure, with type-only server imports: safe for the client bundle.
 */
import { formatNumber } from '../utils'
import { METRICS, type MetricDef, type MetricId, type MetricUnit } from './catalog'
import { bestPoint, changeVsYearAgo, type PeriodMode } from './metrics'
import type { AssetPage } from './service'
import type { Series } from './types'

const NB = ' '
const USD = `US$${NB}`

const defOf = (id: MetricId) => METRICS.find((d) => d.id === id)!
/** Three significant digits for the usual sizes: 45,2 · 2,39. */
const plain = (x: number) => formatNumber(x, { decimals: Math.abs(x) >= 10 ? 1 : 2 })

/** A metric's value as the list shows it; '—' when missing. `currency` is the price's, for 'price'. */
export function formatMetric(value: number | null | undefined, unit: MetricUnit, currency: string | null = 'USD'): string {
  if (value == null || !Number.isFinite(value)) return '—'
  switch (unit) {
    case 'percent':
      return `${formatNumber(value, { decimals: 1 })} %`
    case 'usd':
      return `${USD}${formatNumber(value / 1e6, { decimals: 0 })}${NB}M`
    case 'count':
      return Math.abs(value) >= 1e6 ? `${formatNumber(value / 1e6, { decimals: 1 })}${NB}M` : formatNumber(value, { decimals: 0 })
    case 'price': {
      const symbol = !currency || currency === 'USD' ? 'US$' : currency === 'ARS' ? '$' : currency
      return `${symbol}${NB}${formatNumber(value, { decimals: Math.abs(value) >= 1000 ? 0 : 2 })}`
    }
    default:
      return plain(value)
  }
}

const SUFFIX = /,?\s+(?:inc|corp|corporation|co|company|ltd|limited|plc|s\.?a\.?|n\.?v\.?|ag|se|holdings?|group|sponsored|adr|ads|class\s+[a-z]|common\s+stock|ordinary\s+shares|depositary\s+shares?)\.?$/i

/** "MercadoLibre, Inc." → "MercadoLibre": the name a reader says. */
export function shortName(name: string): string {
  let s = name.trim()
  while (SUFFIX.test(s) && s.replace(SUFFIX, '').trim()) s = s.replace(SUFFIX, '').trim()
  return s
}

/** What the copy can say about one company's value. */
interface Said {
  name: string
  /** The value as the list shows it. */
  v: string
  /** The number alone, without its unit: 5,3 for 5,3 %. */
  n: string
  /** The number alone, without its sign. */
  abs: string
  x: number
}

interface Copy {
  /** What it is, in plain words. */
  what: string
  /** This company's value, said in a sentence. */
  say: (c: Said) => string
  /** How to read it: which way is better, and the usual caveat. */
  read: string
}

const years = (x: number) => (Math.round(x) === 1 ? '1 año' : `${formatNumber(Math.round(x), { decimals: 0 })} años`)
/** A margin or a return: per US$ 100, or a loss when negative. */
const per100 = (gain: (c: Said) => string, loss: (c: Said) => string) => (c: Said) => (c.x < 0 ? loss(c) : gain(c))

const COPY: Record<MetricId, Copy> = {
  pe: {
    what: 'Cuántos años de ganancias estás pagando.',
    say: (c) => `Con ${c.v}, si ${c.name} ganara siempre lo mismo que en los últimos 12 meses, tardaría ${years(c.x)} en devolverte lo que pagás por la acción.`,
    read: 'Más alto = más cara, salvo que la empresa crezca rápido.',
  },
  ps: {
    what: 'Cuánto pagás por cada dólar que la empresa vende en un año.',
    say: (c) => `Con ${c.v}, la bolsa valúa a ${c.name} en ${c.v} veces lo que vendió en los últimos 12 meses.`,
    read: 'Más alto = más cara. Sirve también para empresas que todavía no ganan plata.',
  },
  pcf: {
    what: 'Cuánto pagás por cada dólar de caja que el negocio generó en un año, antes de invertir.',
    say: (c) => `Con ${c.v}, ${c.name} vale en la bolsa ${c.v} veces la caja que generó su negocio en los últimos 12 meses.`,
    read: 'Más alto = más cara. La caja es más difícil de maquillar que la ganancia.',
  },
  pb: {
    what: 'Cuánto pagás por cada dólar de patrimonio: lo que les quedaría a los dueños si la empresa vendiera todo lo que tiene y pagara todas sus deudas, según su balance.',
    say: (c) => `Con ${c.v}, la bolsa paga por ${c.name} ${c.v} veces lo que dice su balance que vale.`,
    read: 'Más alto = más cara. Suele ser alto en empresas que valen por su marca, su tecnología o su gente, cosas que el balance no cuenta.',
  },
  ev: {
    what: 'Lo que costaría comprar la empresa entera: lo que vale en la bolsa, más sus deudas, menos la plata que tiene.',
    say: (c) => `Hoy, comprar ${c.name} entera costaría ${c.v}.`,
    read: 'Solo no dice si está cara: sirve para compararlo con lo que la empresa vende o gana, como en las filas que siguen.',
  },
  evEbitda: {
    what: 'Cuántos años de EBITDA costaría comprar la empresa entera, deudas incluidas. El EBITDA es lo que gana el negocio antes de intereses, impuestos y amortizaciones.',
    say: (c) => `Con ${c.v}, comprar ${c.name} con sus deudas equivale a ${c.v} veces su EBITDA de los últimos 12 meses.`,
    read: 'Más alto = más cara. Compara mejor que el P/E a empresas con mucha y con poca deuda.',
  },
  evSales: {
    what: 'Cuánto costaría comprar la empresa entera, deudas incluidas, por cada dólar que vende en un año.',
    say: (c) => `Con ${c.v}, comprar ${c.name} con sus deudas cuesta ${c.v} veces lo que vendió en los últimos 12 meses.`,
    read: 'Más alto = más cara.',
  },
  evEbit: {
    what: 'Cuántos años de EBIT costaría comprar la empresa entera, deudas incluidas. El EBIT es lo que gana el negocio antes de intereses e impuestos.',
    say: (c) => `Con ${c.v}, comprar ${c.name} con sus deudas equivale a ${c.v} veces su EBIT de los últimos 12 meses.`,
    read: 'Más alto = más cara.',
  },
  peForward: {
    what: 'Como el P/E, pero con la ganancia que los analistas esperan para el próximo año.',
    say: (c) => `Con ${c.v}, si ${c.name} ganara lo que esperan los analistas, tardaría ${years(c.x)} en devolverte lo que pagás por la acción.`,
    read: 'Si es más bajo que el P/E de hoy, los analistas esperan que gane más. Es una estimación, no un dato.',
  },
  psForward: {
    what: 'Como precio / ventas, pero con lo que los analistas esperan que la empresa venda el próximo año.',
    say: (c) => `Con ${c.v}, ${c.name} vale en la bolsa ${c.v} veces lo que los analistas esperan que venda el próximo año.`,
    read: 'Si es más bajo que el de hoy, esperan que venda más. Es una estimación, no un dato.',
  },
  evEbitdaForward: {
    what: 'Como valor de empresa / EBITDA, pero con el EBITDA que los analistas esperan para el próximo año.',
    say: (c) => `Con ${c.v}, comprar ${c.name} con sus deudas equivale a ${c.v} veces el EBITDA que esperan los analistas.`,
    read: 'Si es más bajo que el de hoy, esperan que gane más. Es una estimación, no un dato.',
  },
  pbForward: {
    what: 'Como precio / valor libro, pero con el patrimonio que los analistas esperan para el próximo año.',
    say: (c) => `Con ${c.v}, ${c.name} vale en la bolsa ${c.v} veces el patrimonio que esperan los analistas.`,
    read: 'Es una estimación, no un dato.',
  },
  marketCap: {
    what: 'Lo que vale la empresa entera en la bolsa: el precio de hoy por todas sus acciones.',
    say: (c) => `Hoy, todas las acciones de ${c.name} juntas valen ${c.v}.`,
    read: 'Dice su tamaño, no si está cara: para eso, comparala con lo que gana o vende, como hacen el P/E y precio / ventas.',
  },
  sharesOutstanding: {
    what: 'Cuántas acciones de la empresa hay en total (o certificados, si cotiza como ADR). Cada una es una parte de la empresa.',
    say: (c) => `${c.name} tiene ${c.v} acciones en total.`,
    read: 'Si crece con los años, cada acción es dueña de una parte más chica de la empresa.',
  },
  floatShares: {
    what: 'Las acciones que se compran y venden libremente en la bolsa. Quedan afuera las de fundadores, directivos y socios grandes.',
    say: (c) => `De ${c.name}, ${c.v} acciones están en manos del público.`,
    read: 'Si es poco frente al total, el precio puede moverse mucho con pocas compras o ventas.',
  },
  employees: {
    what: 'Cuántas personas trabajan en la empresa.',
    say: (c) => `${c.name} tiene ${c.v} empleados.`,
    read: 'Sirve para dimensionarla, y para ver cuánto vende o gana por persona.',
  },
  roa: {
    what: 'Cuánto ganó por cada US$ 100 de cosas que tiene (sus activos): caja, edificios, mercadería, préstamos que dio.',
    say: per100(
      (c) => `Con ${c.v}, ${c.name} ganó ${USD}${c.n} por cada ${USD}100 de activos en los últimos 12 meses.`,
      (c) => `Con ${c.v}, ${c.name} perdió ${USD}${c.abs} por cada ${USD}100 de activos en los últimos 12 meses.`,
    ),
    read: 'Más alto = saca más provecho de lo que tiene. Los bancos suelen tenerlo bajo porque tienen muchos activos.',
  },
  roe: {
    what: 'Cuánto ganó por cada US$ 100 que pusieron los dueños (su patrimonio).',
    say: per100(
      (c) => `Con ${c.v}, ${c.name} ganó ${USD}${c.n} por cada ${USD}100 de sus accionistas en los últimos 12 meses.`,
      (c) => `Con ${c.v}, ${c.name} perdió ${USD}${c.abs} por cada ${USD}100 de sus accionistas en los últimos 12 meses.`,
    ),
    read: 'Más alto = mejor uso de la plata de los dueños. Ojo: con mucha deuda también sube.',
  },
  roic: {
    what: 'Cuánto ganó por cada US$ 100 invertidos en el negocio, sumando la plata de los dueños y la que pidió prestada.',
    say: per100(
      (c) => `Con ${c.v}, ${c.name} ganó ${USD}${c.n} por cada ${USD}100 de capital invertido en los últimos 12 meses.`,
      (c) => `Con ${c.v}, ${c.name} perdió ${USD}${c.abs} por cada ${USD}100 de capital invertido en los últimos 12 meses.`,
    ),
    read: 'Más alto = el negocio rinde más sobre todo lo invertido. Acá se mide con la ganancia final, después de intereses e impuestos.',
  },
  grossMargin: {
    what: 'De cada US$ 100 que vende, cuánto le queda después de pagar lo que cuesta hacer o comprar lo que vende.',
    say: per100(
      (c) => `Con ${c.v}, a ${c.name} le quedaron ${USD}${c.n} por cada ${USD}100 que vendió, antes de sueldos de oficina, publicidad, intereses e impuestos.`,
      (c) => `Con ${c.v}, a ${c.name} hacer lo que vende le costó ${USD}${c.abs} más que lo que cobró, por cada ${USD}100.`,
    ),
    read: 'Más alto = más margen para cubrir el resto de los gastos.',
  },
  operatingMargin: {
    what: 'De cada US$ 100 que vende, cuánto le queda después de pagar todos los gastos del negocio, antes de intereses e impuestos.',
    say: per100(
      (c) => `Con ${c.v}, ${c.name} ganó con su negocio ${USD}${c.n} por cada ${USD}100 que vendió.`,
      (c) => `Con ${c.v}, ${c.name} perdió con su negocio ${USD}${c.abs} por cada ${USD}100 que vendió.`,
    ),
    read: 'Más alto = el negocio en sí es más rentable, antes de ver cómo se financia.',
  },
  ebitdaMargin: {
    what: 'De cada US$ 100 que vende, cuánto le queda antes de intereses, impuestos y amortizaciones (el desgaste, en los papeles, de lo que compró para trabajar).',
    say: per100(
      (c) => `Con ${c.v}, a ${c.name} le quedaron ${USD}${c.n} de EBITDA por cada ${USD}100 que vendió.`,
      (c) => `Con ${c.v}, ${c.name} perdió ${USD}${c.abs} de EBITDA por cada ${USD}100 que vendió.`,
    ),
    read: 'Más alto = el negocio deja más plata antes de invertir y de pagar deudas.',
  },
  netMargin: {
    what: 'De cada US$ 100 que vende, cuántos le quedan de ganancia después de pagar todo, impuestos incluidos.',
    say: per100(
      (c) => `Con ${c.v}, a ${c.name} le quedaron ${USD}${c.n} de ganancia por cada ${USD}100 que vendió.`,
      (c) => `Con ${c.v}, ${c.name} perdió ${USD}${c.abs} por cada ${USD}100 que vendió.`,
    ),
    read: 'Más alto = más rentable. Si es negativo, perdió plata.',
  },
  revenueGrowth: {
    what: 'Cuánto más (o menos) vendió en los últimos 12 meses que en los 12 meses anteriores.',
    say: (c) =>
      c.x < 0
        ? `Con ${c.v}, ${c.name} vendió en los últimos 12 meses un ${c.abs} % menos que en los 12 meses anteriores.`
        : `Con ${c.v}, ${c.name} vendió en los últimos 12 meses un ${c.n} % más que en los 12 meses anteriores.`,
    read: 'Más alto = el negocio crece más rápido. Se mide en dólares, así la inflación no cuenta como crecimiento.',
  },
  quickRatio: {
    what: 'Lo que tiene a mano para pagar lo que vence en el próximo año, sin contar la mercadería: caja, inversiones cortas y lo que tiene para cobrar.',
    say: (c) => `Con ${c.v}, ${c.name} tiene ${USD}${c.n} de eso por cada dólar que debe pagar en el próximo año.`,
    read: 'Más de 1 = le alcanza sin vender mercadería. Menos de 1 no es grave si cobra antes de lo que paga.',
  },
  currentRatio: {
    what: 'Lo que tiene para usar o cobrar en el próximo año, contra lo que debe pagar en el mismo plazo.',
    say: (c) => `Con ${c.v}, ${c.name} tiene ${USD}${c.n} de activos de corto plazo por cada dólar de deudas a menos de un año.`,
    read: 'Más de 1 = lo que tiene a corto plazo cubre lo que debe a corto plazo.',
  },
  inventoryTurnover: {
    what: 'Cuántas veces por año vende y repone toda su mercadería.',
    say: (c) => `Con ${c.v}, ${c.name} renueva su mercadería ${c.v} veces por año${c.x > 0 ? `, más o menos cada ${formatNumber(Math.round(365 / c.x), { decimals: 0 })} días` : ''}.`,
    read: 'Más alto = la mercadería pasa menos tiempo parada en el depósito.',
  },
  assetTurnover: {
    what: 'Cuánto vende por año por cada dólar de cosas que tiene (sus activos).',
    say: (c) => `Con ${c.v}, ${c.name} vendió ${USD}${c.n} por cada dólar de activos en los últimos 12 meses.`,
    read: 'Más alto = saca más ventas de lo que tiene. Depende mucho del rubro: un supermercado lo tiene alto y una petrolera, bajo.',
  },
  debtToAssets: {
    what: 'Cuánta deuda financiera (préstamos y bonos) tiene por cada dólar de activos.',
    say: (c) => `Con ${c.v}, ${c.name} debe ${USD}${c.n} en préstamos y bonos por cada dólar de activos.`,
    read: 'Más alto = más endeudada. Más de 0,5 quiere decir que la deuda pasa la mitad de lo que tiene.',
  },
  debtToEquity: {
    what: 'Cuánta deuda financiera (préstamos y bonos) tiene por cada dólar que pusieron los dueños.',
    say: (c) => `Con ${c.v}, ${c.name} debe ${USD}${c.n} por cada dólar de patrimonio.`,
    read: 'Más alto = más endeudada, y más riesgo si el negocio anda mal. En los bancos es normal que sea alto.',
  },
  ltDebtToAssets: {
    what: 'Cuánta deuda que vence en más de un año tiene por cada dólar de activos.',
    say: (c) => `Con ${c.v}, ${c.name} tiene ${USD}${c.n} de deuda a largo plazo por cada dólar de activos.`,
    read: 'Más alto = más endeudada a largo plazo. La deuda larga aprieta menos que la que vence pronto.',
  },
  ltDebtToEquity: {
    what: 'Cuánta deuda que vence en más de un año tiene por cada dólar de patrimonio.',
    say: (c) => `Con ${c.v}, ${c.name} debe a largo plazo ${USD}${c.n} por cada dólar de patrimonio.`,
    read: 'Más alto = más endeudada a largo plazo.',
  },
  revenuePerShare: {
    what: 'Lo que vendió la empresa en un año, repartido entre todas sus acciones.',
    say: (c) => `A cada acción de ${c.name} le corresponden ${USD}${c.n} de ventas de los últimos 12 meses.`,
    read: 'Sirve para ver si las ventas crecen por acción, no solo en total.',
  },
  ocfPerShare: {
    what: 'La caja que generó el negocio en un año, antes de invertir, repartida entre todas las acciones.',
    say: (c) => `A cada acción de ${c.name} le corresponden ${USD}${c.n} de flujo de caja operativo de los últimos 12 meses.`,
    read: 'Más alto = el negocio genera más caja por acción.',
  },
  fcfPerShare: {
    what: 'La caja que le quedó después de invertir en el negocio, repartida entre las acciones. Es la plata que puede usar para pagar dividendos, recomprar acciones o bajar deuda.',
    say: (c) => `A cada acción de ${c.name} le corresponden ${USD}${c.n} de caja libre de los últimos 12 meses.`,
    read: 'Más alto = mejor. Si es negativo, gastó más caja de la que generó.',
  },
  ebitPerShare: {
    what: 'Lo que ganó el negocio en un año antes de intereses e impuestos (el EBIT), repartido entre las acciones.',
    say: (c) => `A cada acción de ${c.name} le corresponden ${USD}${c.n} de EBIT de los últimos 12 meses.`,
    read: 'Más alto = mejor. Si es negativo, el negocio perdió plata antes de intereses e impuestos.',
  },
  ebitdaPerShare: {
    what: 'Lo que ganó el negocio en un año antes de intereses, impuestos y amortizaciones (el EBITDA), repartido entre las acciones.',
    say: (c) => `A cada acción de ${c.name} le corresponden ${USD}${c.n} de EBITDA de los últimos 12 meses.`,
    read: 'Más alto = mejor.',
  },
  bookPerShare: {
    what: 'El patrimonio de la empresa (lo que les quedaría a los dueños si vendiera todo y pagara sus deudas, según el balance), repartido entre las acciones.',
    say: (c) => `Cada acción de ${c.name} tiene ${USD}${c.n} de patrimonio según el balance.`,
    read: 'Comparalo con el precio: si el precio es mucho más alto, la bolsa valora cosas que el balance no cuenta.',
  },
  tangibleBookPerShare: {
    what: 'Como el valor libro, pero sin lo que no se puede tocar ni vender fácil: marcas, patentes y lo que pagó de más al comprar otras empresas.',
    say: (c) => `Cada acción de ${c.name} tiene ${USD}${c.n} de patrimonio tangible.`,
    read: 'Es una mirada más prudente del valor libro. Puede ser negativo en empresas que compraron muchas otras.',
  },
  cashPerShare: {
    what: 'La plata que tiene la empresa (caja e inversiones de corto plazo), repartida entre las acciones.',
    say: (c) => `Por cada acción, ${c.name} tiene ${USD}${c.n} de caja.`,
    read: 'Más alto = más colchón. Comparalo con la deuda por acción.',
  },
  debtPerShare: {
    what: 'La deuda financiera de la empresa (préstamos y bonos), repartida entre las acciones.',
    say: (c) => `Por cada acción, ${c.name} debe ${USD}${c.n}.`,
    read: 'Más bajo = menos endeudada. Comparalo con la caja por acción.',
  },
  workingCapitalPerShare: {
    what: 'Lo que tiene a menos de un año (caja, lo que tiene para cobrar, mercadería) menos lo que debe en el mismo plazo, repartido entre las acciones.',
    say: (c) => `Por cada acción, ${c.name} tiene ${USD}${c.n} de capital de trabajo.`,
    read: 'Positivo = lo que tiene a corto plazo cubre lo que debe a corto plazo.',
  },
  capexPerShare: {
    what: 'Lo que invirtió en un año en cosas que duran (edificios, máquinas, tecnología), repartido entre las acciones.',
    say: (c) => `Por cada acción, ${c.name} invirtió ${USD}${c.n} en los últimos 12 meses.`,
    read: 'Ni bueno ni malo solo: comparalo con el flujo de caja operativo, que es de donde sale esa plata.',
  },
  eps: {
    what: 'La ganancia de la empresa en un año, repartida entre las acciones.',
    say: (c) => `A cada acción de ${c.name} le corresponden ${USD}${c.n} de ganancia de los últimos 12 meses.`,
    read: 'Más alto = mejor. Lo que más importa es si crece año a año. Si es negativo, perdió plata.',
  },
  priceTarget: {
    what: 'El precio que, en promedio, los analistas que siguen la empresa creen que va a tener esta cotización en unos 12 meses, en su misma moneda. Es el mismo dato que ves en Resumen.',
    say: (c) => `Para ${c.name}, el promedio de los analistas es ${c.v}.`,
    read: 'Es una opinión, no un dato: los analistas se equivocan seguido.',
  },
  beta: {
    what: 'Cuánto se movió la acción cada vez que se movió el mercado, en el último año.',
    say: (c) =>
      c.x < 0
        ? `Con ${c.v}, la acción de ${c.name} tendió a moverse al revés que el mercado.`
        : `Con ${c.v}, cuando el mercado subió o bajó 10 %, la acción de ${c.name} se movió en promedio ${formatNumber(c.x * 10, { decimals: 1 })} %.`,
    read: '1 = se mueve como el mercado. Más de 1 = se mueve más. Menos de 1 = se mueve menos.',
  },
}

export interface Explanation {
  what: string
  /** Null when the company has no value. */
  example: string | null
  read: string
}

/** The "?" text of one metric, with this company's name and value said in it. */
export function explain(id: MetricId, name: string, value: number | null, currency: string | null = 'USD'): Explanation {
  const { what, say, read } = COPY[id]
  if (value === null || !Number.isFinite(value)) return { what, example: null, read }
  const unit = defOf(id).unit
  const n = unit === 'percent' ? formatNumber(value, { decimals: 1 }) : formatMetric(value, unit, currency)
  const abs = unit === 'percent' ? formatNumber(Math.abs(value), { decimals: 1 }) : formatMetric(Math.abs(value), unit, currency)
  return { what, example: say({ name, v: formatMetric(value, unit, currency), n, abs, x: value }), read }
}

/** "Sus parecidas: Amazon 19,6 · Sea 29,0"; peers with no value are left out. Null when none has one. */
export function peersLine(id: MetricId, peers: { name: string; value: number | null }[]): string | null {
  // Price targets are each in their own listing's currency: side by side they say nothing.
  if (id === 'priceTarget') return null
  const unit = defOf(id).unit
  const items = peers.filter((p) => p.value !== null && Number.isFinite(p.value)).map((p) => `${p.name} ${formatMetric(p.value, unit)}`)
  return items.length ? `Sus parecidas: ${items.join(' · ')}` : null
}

/** A ratio over a base that is negative is left empty by the catalog: these rows say which base. */
const NEGATIVE_BASE: Partial<Record<MetricId, { base: MetricId[]; why: string }>> = {
  pe: { base: ['netMargin', 'eps'], why: 'No aplica: la empresa perdió plata en los últimos 12 meses' },
  evEbitda: { base: ['ebitdaMargin', 'ebitdaPerShare'], why: 'No aplica: su EBITDA es negativo' },
  evEbit: { base: ['ebitPerShare'], why: 'No aplica: su EBIT es negativo' },
  pcf: { base: ['ocfPerShare'], why: 'No aplica: su flujo de caja operativo es negativo' },
  pb: { base: ['bookPerShare'], why: 'No aplica: su patrimonio es negativo' },
  roe: { base: ['bookPerShare'], why: 'No aplica: su patrimonio es negativo' },
  debtToEquity: { base: ['bookPerShare'], why: 'No aplica: su patrimonio es negativo' },
  ltDebtToEquity: { base: ['bookPerShare'], why: 'No aplica: su patrimonio es negativo' },
}

/** What nullReason reads: a whole page, or a peer's today's values alone (no history, no sources). */
export interface Known {
  metrics: Partial<Record<MetricId, { today: number | null; history?: Record<PeriodMode, Series> }>> | null
  sources: AssetPage['sources']
}

/** Why a row shows "—". */
export function nullReason(id: MetricId, page: Known): string {
  const def = defOf(id)
  // The analysts' target has its own source, the profile: Resumen says when it failed.
  if (def.group === 'profile') return 'Sin datos'
  if (page.sources[def.group === 'Y' ? 'yahoo' : 'tradingview'] === 'error') return 'Sin datos: la fuente no respondió'
  if (def.group !== 'snapshot' && page.sources.fx === 'error') return 'Sin datos: no pudimos pasar sus números a dólares'
  const negative = NEGATIVE_BASE[id]
  if (negative?.base.some((b) => (page.metrics?.[b]?.today ?? 0) < 0)) return negative.why
  const history = page.metrics?.[id]?.history
  if (history && Object.values(history).some((s) => s.length > 0)) return 'Falta el dato del último trimestre'
  return 'Sin datos'
}

/** True when the formula reads a flow (a period's sales, earnings, cash): else it is one date's balance. */
function readsFlow(def: MetricDef): boolean {
  let flow = false
  const mark = () => ((flow = true), 1)
  if ('formula' in def) def.formula({ flow: mark, yearAgo: mark, yearly: mark, bal: () => 1, avg: () => 1, mcap: 1, units: 1 })
  return flow
}

/** What the history panel's headline covers: a flow, the 12 months to `asOf`; a balance, its close then. */
export function basisLabel(id: MetricId, asOf: string | null): string {
  const when = asOf && periodLabel(asOf, 'ttm')
  if (readsFlow(defOf(id))) return when ? `Últimos 12 meses a ${when}` : 'Últimos 12 meses'
  return when ? `Al cierre de ${when}` : 'Al cierre del último balance'
}

// Fixed, not Intl: ICU versions disagree ("sep" vs "sept"), so Node 22, Node 26 and browsers would differ.
export const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** A point's period: "abr–jun 2026" (the three months ending at `end`), "2025" in annual mode, "hoy". */
export function periodLabel(end: string, mode: PeriodMode, today?: string | null): string {
  if (end === today) return 'hoy'
  const year = end.slice(0, 4)
  if (mode === 'annual') return year
  const m = Number(end.slice(5, 7)) - 1
  return `${MONTHS[(m + 10) % 12]}–${MONTHS[m]} ${year}`
}

/** 2019, 2020, 2022 → "2019–2020, 2022". */
function yearRanges(years: number[]): string {
  const out: string[] = []
  for (let i = 0; i < years.length; i++) {
    let j = i
    while (years[j + 1] === years[j] + 1) j++
    out.push(i === j ? `${years[i]}` : `${years[i]}–${years[j]}`)
    i = j
  }
  return out.join(', ')
}

// A negative value of these means a net loss: the copy can say so.
const LOSS = new Set<MetricId>(['netMargin', 'eps', 'roa', 'roe', 'roic'])
const WORDS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez']

/**
 * "¿Cómo viene?": where the series started and ended, the years it was negative, its best point,
 * the streak it ends on and the change against a year before. Facts from the numbers only.
 * `today` is the end of the "hoy" point, when the series has one; `asOf` the period hoy is built on.
 */
export function howItGoes(id: MetricId, series: Series, mode: PeriodMode, today: string | null, asOf: string | null = null): string[] {
  const last = series[series.length - 1]
  const periods = last?.end === today ? series.slice(0, -1) : series
  if (periods.length < 2) return ['Todavía no hay historia suficiente para ver cómo viene.']
  const def = defOf(id)
  const fmt = (x: number) => formatMetric(x, def.unit)
  const label = (end: string) => periodLabel(end, mode, today)
  const first = series[0]
  const out = [`Pasó de ${fmt(first.value)} en ${label(first.end)} a ${fmt(last.value)}${last.end === today ? ' hoy' : ` en ${label(last.end)}`}.`]

  const negatives = periods.filter((p) => p.value < 0)
  if (negatives.length) {
    const loss = LOSS.has(id)
    const years = yearRanges([...new Set(negatives.map((p) => Number(p.end.slice(0, 4))))])
    const after = series[series.indexOf(negatives[negatives.length - 1]) + 1]
    const turn = after && last.value >= 0 ? `, y ${loss ? 'gana' : 'es positivo'} desde ${label(after.end)}` : ''
    out.push(`${loss ? 'Perdió plata' : 'Fue negativo'} en ${years}${turn}.`)
  }

  const better = 'better' in def ? def.better : 'higher'
  const word = better === 'higher' ? 'máximo' : 'mínimo'
  const best = bestPoint(series, better)!
  out.push(best === last && last.end === today ? `Hoy está en su ${word} del período.` : `Su ${word} fue ${fmt(best.value)} en ${label(best.end)}.`)

  let streak = 0
  let dir = 0
  for (let i = periods.length - 1; i > 0; i--) {
    const d = Math.sign(periods[i].value - periods[i - 1].value)
    if (d === 0 || (dir !== 0 && d !== dir)) break
    dir = d
    streak++
  }
  if (streak >= 2) {
    out.push(`${dir > 0 ? 'Subió' : 'Bajó'} ${WORDS[streak] ?? streak} ${mode === 'annual' ? 'años' : 'trimestres'} seguidos, hasta ${label(periods[periods.length - 1].end)}.`)
  }

  // Últimos 12 meses compares hoy, like the list; a quarter or a year compares its last period.
  const change = changeVsYearAgo(mode === 'ttm' ? series : periods, def.unit, asOf)
  if (change !== null) {
    const size = `${formatNumber(Math.abs(change), { decimals: 1 })}${def.unit === 'percent' ? ' puntos' : ' %'}`
    const then = mode === 'quarterly' ? 'el mismo trimestre de un año antes' : 'un año antes'
    out.push(`Contra ${then}, ${change > 0 ? `subió ${size}` : change < 0 ? `bajó ${size}` : 'quedó igual'}.`)
  }
  return out
}

