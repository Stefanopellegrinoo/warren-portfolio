'use client'

import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AssetPage } from '@/lib/fundamentals/service'
import { METRICS, type MetricDef, type MetricId, type Section } from '@/lib/fundamentals/catalog'
import { explain, formatMetric, nullReason, peersLine, shortName } from '@/lib/fundamentals/explain'
import { PERIOD_MODES, type MetricValue } from '@/lib/fundamentals/metrics'
import { cn } from '@/lib/utils'
import { HistoryPanel, peerName } from './HistoryPanel'

/** Where the history becomes a panel beside the list instead of a screen of its own. */
const WIDE = '(min-width: 1024px)'

/** The panel desktop opens on, as in the approved mockup; else the first row with history. */
const FIRST: MetricId = 'netMargin'

/**
 * One column of sections at every width, as the phone reads them (odd/tasks/asset-page.md L24): the
 * longest row needs about 400 px at 15 px, so two columns plus a 360 px panel never fit the page.
 */
const ORDER: readonly Section[] = ['Estadísticas clave', 'Valoración', 'Rentabilidad', 'Liquidez', 'Solvencia', 'Por acción (US$)', 'Analistas y riesgo']

const hasHistory = (m: MetricValue) => PERIOD_MODES.some((k) => m.history[k].length > 0)
const isMetricId = (v: string | null): v is MetricId => METRICS.some((d) => d.id === v)

/**
 * The "Números" tab (odd/tasks/asset-page.md T6, S2 S3): every catalog metric by section, each
 * with its "?" and, when it has history, a click into it. The open metric lives in `?dato=`, so
 * the phone's back button closes its screen.
 */
export function NumerosTab({ page }: { page: AssetPage }) {
  const [dato, setDato] = useState<MetricId | null>(null)
  const pushed = useRef(false)

  useEffect(() => {
    const read = () => {
      const v = new URLSearchParams(window.location.search).get('dato')
      setDato(isMetricId(v) ? v : null)
    }
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])

  const metrics = page.metrics
  if (!page.supported) return <p className="py-6 text-sm text-ink-2">Todavía no tenemos datos financieros de este mercado.</p>
  if (!metrics) return <p className="py-6 text-sm text-ink-2">No pudimos traer los números de esta empresa. Probá de nuevo en un rato.</p>

  const open = dato && hasHistory(metrics[dato]) ? dato : null
  const selected = open ?? [FIRST, ...METRICS.map((d) => d.id)].find((id) => hasHistory(metrics[id])) ?? null
  const name = shortName(page.name)
  // The price target is in the currency of the listing Números reads: a BYMA listing quotes in pesos.
  const currency = page.listingCurrency ?? (page.bymaListing ? 'ARS' : page.currency)
  const stale = Object.values(page.sources).includes('stale')

  function show(id: MetricId) {
    const url = new URL(window.location.href)
    url.searchParams.set('dato', id)
    // A phone opens a screen the back button closes; a desktop only swaps the panel.
    if (window.matchMedia?.(WIDE).matches || open) window.history.replaceState(null, '', url)
    else {
      window.history.pushState(null, '', url)
      pushed.current = true
    }
    setDato(id)
  }

  function back() {
    if (pushed.current) {
      pushed.current = false
      window.history.back()
      return
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('dato')
    window.history.replaceState(null, '', url)
    setDato(null)
  }

  const section = (s: Section) => {
    const defs: readonly MetricDef[] = METRICS.filter((d) => d.section === s)
    return (
      <section key={s} aria-labelledby={`numeros-${s}`} className="rounded-lg border border-line bg-surface px-4 pb-1 pt-4">
        <h3 id={`numeros-${s}`} className="text-[17px] font-semibold leading-tight">{s}</h3>
        <ul className={cn('mt-2', s === 'Por acción (US$)' && 'cq-wide:grid cq-wide:grid-cols-2 cq-wide:gap-x-6 cq-wide:[&>li:nth-child(2)]:border-t-0')}>
          {defs.map((d, i) => (
            <Fragment key={d.id}>
              {d.subsection && d.subsection !== defs[i - 1]?.subsection && (
                <li className="border-t border-line pb-1 pt-4 text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">{d.subsection}</li>
              )}
              <Row page={page} def={d} name={name} currency={currency} selected={d.id === selected} onOpen={show} />
            </Fragment>
          ))}
        </ul>
      </section>
    )
  }

  return (
    // The list stops at 40rem, so a value stays near its label; the panel takes the rest, never under 22.5rem.
    <div className="grid gap-5 lg:grid-cols-[minmax(0,40rem)_minmax(22.5rem,1fr)] lg:items-start lg:gap-6">
      <div className="min-w-0 max-w-[40rem] [container-type:inline-size]">
        <p className="mb-4 max-w-prose text-sm leading-relaxed text-ink-2">
          Datos de hoy, montos en dólares{page.listing?.market === 'argentina' ? ' CCL' : ''}.{' '}
          <span className="lg:hidden">Tocá el &quot;?&quot; para ver qué significa cada uno, y el dato para ver su historia.</span>
          <span className="max-lg:hidden">Pasá el mouse por el &quot;?&quot; para ver qué significa; hacé click en cualquier dato para ver su historia a la derecha.</span>
          {stale && ' Algunos datos son de la última vez que pudimos traerlos.'}
        </p>
        <div className="flex flex-col gap-6">{ORDER.map(section)}</div>
      </div>
      {selected && (
        <HistoryPanel
          page={page}
          id={selected}
          full={open !== null}
          onBack={back}
          className={cn(
            'lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto',
            open
              ? 'max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:overflow-y-auto max-lg:overscroll-contain max-lg:bg-canvas max-lg:pt-[max(1rem,env(safe-area-inset-top))]'
              : 'max-lg:hidden',
          )}
        />
      )}
    </div>
  )
}

/** One metric: label, "?", value; a button into its history when it has one. */
function Row({ page, def, name, currency, selected, onOpen }: {
  page: AssetPage
  def: MetricDef
  name: string
  currency: string | null
  selected: boolean
  onOpen: (id: MetricId) => void
}) {
  const id = def.id as MetricId
  const m = page.metrics![id]
  // Pinned by a click or a tap; peeked by a mouse over the "?" (and over the tip it opens).
  const [pinned, setPinned] = useState(false)
  const [peek, setPeek] = useState(false)
  const open = pinned || peek
  const item = useRef<HTMLLIElement>(null)
  const q = useRef<HTMLButtonElement>(null)
  const tip = useId()

  useEffect(() => {
    if (!open) return
    const close = () => {
      setPinned(false)
      setPeek(false)
    }
    const onDown = (e: Event) => {
      if (!item.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      q.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const history = hasHistory(m)
  // An ADR's Números read its BYMA listing: so does the target, in pesos.
  const label = id === 'priceTarget' && page.bymaListing ? `${def.label} (en\u00a0BYMA)` : def.label
  // The "?" stays on the line of the label's last word.
  const cut = label.lastIndexOf(' ') + 1
  const value = formatMetric(m.today, def.unit, currency)
  const e = explain(id, name, m.today, currency)
  const peers = peersLine(id, page.peers.map((p) => ({ name: peerName(p), value: p.today[id] })))

  return (
    <li ref={item} className="relative border-t border-line first:border-t-0" onPointerLeave={(ev) => ev.pointerType === 'mouse' && setPeek(false)}>
      <div className={cn('relative -mx-4 flex min-h-11 items-center gap-3 px-4 py-2', history && 'hover:bg-hover', selected && 'lg:bg-accent-soft lg:shadow-[inset_3px_0_0_var(--accent)]')}>
        {history && (
          <button
            type="button"
            aria-label={`${label}: ${value}. Ver su historia`}
            aria-current={selected || undefined}
            onClick={() => onOpen(id)}
            className="absolute inset-0 cursor-pointer focus-visible:outline-offset-[-2px]"
          />
        )}
        <span className="min-w-0 flex-1 text-[15px] leading-snug">
          {label.slice(0, cut)}
          <span className="whitespace-nowrap">
            {label.slice(cut)}
            <button
              ref={q}
              type="button"
              aria-label={`Qué es ${label}`}
              aria-expanded={open}
              aria-controls={tip}
              onClick={() => {
                if (pinned) setPeek(false)
                setPinned(!pinned)
              }}
              onPointerEnter={(ev) => ev.pointerType === 'mouse' && setPeek(true)}
              // 18 px drawn, 44 px to tap.
              className="relative z-10 ml-1.5 inline-grid h-[18px] w-[18px] place-items-center rounded-full bg-surface-2 align-[1px] font-mono text-[11px] font-semibold leading-none text-ink-2 before:absolute before:-inset-[13px] before:content-[''] hover:bg-hover hover:text-ink aria-expanded:bg-ink aria-expanded:text-canvas"
            >
              ?
            </button>
          </span>
        </span>
        <span className="shrink-0 font-mono text-[15px] font-medium">{value}</span>
        {history
          ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" />
          : <span className="w-3.5 shrink-0" aria-hidden="true" />}
      </div>
      {open && (
        <div id={tip} className="mb-2 max-w-prose rounded-md bg-ink p-3 text-[15px] leading-normal text-canvas shadow-pop lg:absolute lg:inset-x-0 lg:top-[calc(100%-4px)] lg:z-30">
          <p>
            <b>¿Qué es?</b> {e.what} {e.example ?? `${nullReason(id, page)}.`} <b>{e.read}</b>
          </p>
          {peers && <p className="mt-2 opacity-75">{peers}</p>}
          {history && (
            <button type="button" onClick={() => { setPinned(false); setPeek(false); onOpen(id) }} className="mt-1.5 min-h-8 font-medium text-accent-soft underline-offset-2 hover:underline max-[819px]:min-h-11">
              Ver su historia →
            </button>
          )}
        </div>
      )}
    </li>
  )
}
