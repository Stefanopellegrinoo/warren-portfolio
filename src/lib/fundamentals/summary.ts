/**
 * Resumen's two answers (odd/tasks/asset-page.md T9, S11; design goal 8), built only from the page's
 * own numbers: the same metrics Números and Comparar show. Facts, never advice: the pill names a
 * fact ("Crece fuerte"), and missing data says so instead of guessing.
 *
 * Pure, with type-only server imports: safe for the client bundle.
 */
import { formatNumber } from '../utils'
import { changeVsYearAgo, peersMedian, type MetricValue } from './metrics'
import type { MetricId } from './catalog'
import type { AssetPage } from './service'

export type Tone = 'ok' | 'neutral' | 'warn' | 'bad'

export interface Answer {
  /** Null when a fact it needs is missing: then there is no pill, only what is known. */
  tone: Tone | null
  label: string | null
  text: string
  /** The Números rows the answer reads, as it says them. */
  facts: MetricId[]
}

/** Sales growth over 12 months, in %: "Crece fuerte" from 15, "Crece" from 3, "Vende menos" at −3 or below; between, "Ventas estables". */
const GROWTH = { strong: 15, up: 3, down: -3 }
/** A net margin that moved less than this many points in a year is "estable". */
const MARGIN_STEP = 0.5
/** A multiple more than 15 % above (below) what it is compared with is "más cara" ("más barata"); closer, "en línea". */
const BAND = 0.15
/** A median of peers needs at least two of them with the number. */
const MIN_PEERS = 2
/** Its own 5-year median needs at least 4 of those years: 16 quarters of 12-month values. */
const MIN_OWN = 16

const NO_BOOKS: Answer = { tone: null, label: null, text: 'Todavía no tenemos sus balances.', facts: [] }
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
/** 46 · 4,5: whole numbers from 10 up, as people say them. */
export const spoken = (x: number) => formatNumber(x, { decimals: Math.abs(x) >= 10 ? 0 : 1 })
const n = spoken

/**
 * "¿Le va bien como empresa?": sales over 12 months, whether it makes money, and where its net margin
 * went in a year. ok: makes money and grows; neutral: makes money, sales stable; warn: one of the two
 * goes the wrong way; bad: loses money and does not grow. The margin only qualifies the sentence.
 */
export function businessAnswer(page: AssetPage): Answer {
  const m = page.metrics
  if (!m) return NO_BOOKS
  const g = m.revenueGrowth.today
  const nm = m.netMargin.today
  const sales = g === null ? null : `vende ${n(Math.abs(g))} % ${g < 0 ? 'menos' : 'más'} que hace un año`
  const profit = nm === null ? null : nm > 0 ? 'gana plata' : nm < 0 ? 'pierde plata' : 'no gana plata'
  const facts = (['revenueGrowth', 'netMargin'] as const).filter((id) => m[id].today !== null)
  if (sales === null || profit === null || g === null || nm === null) {
    const text = sales ? `${cap(sales)}; no tenemos su ganancia de los últimos 12 meses.`
      : profit ? `${cap(profit)} en los últimos 12 meses; no tenemos cuánto cambiaron sus ventas.`
      : 'Todavía no tenemos sus ventas ni sus ganancias de los últimos 12 meses.'
    return { tone: null, label: null, text, facts }
  }

  const grows = g >= GROWTH.up
  const shrinks = g <= GROWTH.down
  const earns = nm > 0
  const tone: Tone = earns ? (grows ? 'ok' : shrinks ? 'warn' : 'neutral') : grows ? 'warn' : 'bad'
  const label = !earns ? cap(profit) : g >= GROWTH.strong ? 'Crece fuerte' : grows ? 'Crece' : shrinks ? 'Vende menos' : 'Ventas estables'
  const lead = { ok: 'Sí', neutral: 'Más o menos', warn: 'Más o menos', bad: 'No' }[tone]
  // "pero" only where one fact is clearly good and the other clearly bad.
  const and = (grows && !earns) || (shrinks && earns) ? ', pero' : ' y'
  const dm = changeVsYearAgo(m.netMargin.history.ttm, 'percent', m.netMargin.asOf)
  // The margin agrees with the profit clause ("y") or turns it ("aunque").
  const margin = dm === null ? ''
    : Math.abs(dm) < MARGIN_STEP ? ', con el margen estable'
    : `${dm > 0 === earns ? ', y' : ', aunque'} su margen ${dm > 0 ? 'subió' : 'bajó'} ${formatNumber(Math.abs(dm), { decimals: 1 })} puntos`
  return { tone, label, text: `${lead}: ${sales}${and} ${profit}${margin}.`, facts }
}

/** −1 cheaper, 0 in line, 1 dearer, by BAND. */
const side = (x: number, base: number) => (x > base * (1 + BAND) ? 1 : x < base * (1 - BAND) ? -1 : 0)
const versus = (s: number, whom: string) => `${['más barata que', 'en línea con', 'más cara que'][s + 1]} ${whom}`
const OWN = 'su propia mediana de 5 años'

/** The median of its own 12-month values in the 5 years to its latest statements; null with less than 4 of them. */
function ownMedian(m: MetricValue): number | null {
  const asOf = m.asOf
  if (!asOf) return null
  const from = `${Number(asOf.slice(0, 4)) - 5}${asOf.slice(4)}`
  const own = m.history.ttm.filter((p) => p.end > from && p.end <= asOf)
  return own.length >= MIN_OWN ? peersMedian(own.map((p) => p.value)) : null
}

/**
 * "¿Está cara?": P/E against its peers' median and against its own 5-year median; with a loss, P/E
 * does not apply and price / sales takes its place. Each comparison scores −1, 0 or 1 by BAND; their
 * sum gives the tone: ≤ −1 ok, 0 neutral, 1 warn, 2 bad.
 */
export function priceAnswer(page: AssetPage): Answer {
  const m = page.metrics
  if (!m) return NO_BOOKS
  const loss = [m.netMargin.today, m.eps.today].some((v) => v !== null && v < 0)
  const id = m.pe.today === null && loss ? 'ps' : 'pe'
  const name = id === 'pe' ? 'P/E' : 'precio/ventas'
  const lead = id === 'ps' ? 'El P/E no aplica porque perdió plata en los últimos 12 meses; miramos precio/ventas. ' : ''
  const v = m[id].today
  if (v === null) return { tone: null, label: null, text: `${lead}No tenemos su ${name} de hoy.`, facts: [] }

  const values = page.peers.map((p) => p.today[id]).filter((x): x is number => x !== null)
  const peers = values.length >= MIN_PEERS ? peersMedian(values) : null
  const own = ownMedian(m[id])
  const sp = peers === null ? null : side(v, peers)
  const so = own === null ? null : side(v, own)
  let text: string
  if (sp !== null) {
    text = `${cap(versus(sp, 'sus parecidas'))}: ${name} ${n(v)} contra ${n(peers!)} de mediana. `
      + (so === null ? 'No tenemos 5 años de su historia para comparar.' : `${so === sp ? 'También' : 'Pero'} ${versus(so, OWN)} (${n(own!)}).`)
  } else if (so !== null) {
    text = `${cap(versus(so, OWN))}: ${name} ${n(v)} contra ${n(own!)}. No hay suficientes parecidas con el dato para comparar.`
  } else {
    return { tone: null, label: null, text: `${lead}${name} ${n(v)}. No tenemos con qué compararlo: ni parecidas con el dato ni 5 años de su historia.`, facts: [id] }
  }
  const score = (sp ?? 0) + (so ?? 0)
  const tone: Tone = score >= 2 ? 'bad' : score === 1 ? 'warn' : score === 0 ? 'neutral' : 'ok'
  const label = sp !== null ? cap(versus(sp, 'sus parecidas')) : cap(versus(so!, 'su historia'))
  return { tone, label, text: lead + text, facts: [id] }
}

/** Yahoo's eleven sectors. */
const SECTORS: Record<string, string> = {
  Technology: 'Tecnología', 'Consumer Cyclical': 'Consumo discrecional', 'Consumer Defensive': 'Consumo básico',
  'Financial Services': 'Servicios financieros', Healthcare: 'Salud', Industrials: 'Industria', Energy: 'Energía',
  'Basic Materials': 'Materiales', 'Communication Services': 'Comunicaciones', 'Real Estate': 'Inmobiliario', Utilities: 'Servicios públicos',
}
export const sectorName = (s: string) => SECTORS[s] ?? s

let countries: Map<string, string> | null = null
/** Yahoo's English country name in Spanish, through the browser's own region names; anything else as it came. */
export function countryName(name: string): string {
  if (!countries) {
    const en = new Intl.DisplayNames(['en'], { type: 'region' })
    const es = new Intl.DisplayNames(['es'], { type: 'region' })
    countries = new Map()
    // Every two-letter code: an unknown one names itself, never a country.
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b)
        const english = en.of(code)
        if (english && english !== code) countries.set(english, es.of(code) ?? english)
      }
    }
  }
  return countries.get(name) ?? name
}
